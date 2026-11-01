package tickets

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"ansa/core/internal/database"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// What a change ended in.
const (
	Changed    = "changed"
	Unchanged  = "unchanged"
	Refused    = "refused"
	NotAllowed = "not-allowed"
)

// lockForChange reads what the request has now and locks its row until the
// transaction ends ("no key update": notes may still be written). ok false:
// not this company's.
func lockForChange(ctx context.Context, tx database.Tx, company tenant.CompanyID, ticketID string) (assignee, category *string, ok bool, err error) {
	err = tx.QueryRow(ctx, `SELECT assigned_to_user_id, category FROM tickets WHERE company_id = $1 AND id = $2 FOR NO KEY UPDATE`,
		company.String(), ticketID).Scan(&assignee, &category)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, false, nil
	}
	return assignee, category, err == nil, err
}

// Assign gives the request to a person of the company who can take tickets
// (their row locked in the UPDATE: a removal saved at that moment is waited
// for, then refuses), or takes it off ("" = unassign). The same assignee
// again changes nothing. Whoever gets it is emailed, unless they assigned
// it to themselves.
func Assign(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, ticketID, assigneeID string) (string, error) {
	outcome := Changed
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		current, _, ok, err := lockForChange(ctx, tx, company, ticketID)
		if err != nil || !ok {
			outcome = Refused
			return err
		}
		if (current == nil && assigneeID == "") || (current != nil && *current == assigneeID) {
			outcome = Unchanged
			return nil
		}
		const update = `
			UPDATE tickets SET assigned_to_user_id = NULLIF($3, ''), assigned_automatically = CASE WHEN $3 = '' THEN NULL ELSE false END
			WHERE company_id = $1 AND id = $2
				AND ($3 = '' OR EXISTS (SELECT 1 FROM users WHERE company_id = $1 AND id = $3 AND email_verified AND deactivated_at IS NULL FOR SHARE))`
		tag, err := tx.Exec(ctx, update, company.String(), ticketID, assigneeID)
		if err != nil || tag.RowsAffected() == 0 {
			outcome = Refused
			return err
		}
		kind, target := "assigned", assigneeID
		if assigneeID == "" {
			kind, target = "unassigned", *current
		}
		if err := recordChangeWithin(ctx, tx, company, ticketID, kind, actorUserID, target, nil); err != nil {
			return err
		}
		if assigneeID != "" && assigneeID != actorUserID {
			return QueueAssignedEmailWithin(ctx, tx, company, ticketID, assigneeID)
		}
		return nil
	})
	return outcome, err
}

// SetCategory sets (or clears, "") the request's category: an active one of
// the company. An open, unassigned request is then routed, also when the
// category is the one it already has (how a request goes back to routing).
// A rename at that very moment ends in the foreign key's refusal: refused.
func SetCategory(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, ticketID, category string) (string, error) {
	outcome := Changed
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		_, current, ok, err := lockForChange(ctx, tx, company, ticketID)
		if err != nil || !ok {
			outcome = Refused
			return err
		}
		if (current == nil && category == "") || (current != nil && *current == category) {
			routed, err := routeIfUnassignedWithin(ctx, tx, company, ticketID)
			if !routed {
				outcome = Unchanged
			}
			return err
		}
		const update = `
			UPDATE tickets SET category = NULLIF($3, '')
			WHERE company_id = $1 AND id = $2
				AND ($3 = '' OR EXISTS (SELECT 1 FROM categories WHERE company_id = $1 AND name = $3 AND archived_at IS NULL))`
		tag, err := tx.Exec(ctx, update, company.String(), ticketID, category)
		if err != nil || tag.RowsAffected() == 0 {
			outcome = Refused
			return err
		}
		var named *string
		if category != "" {
			named = &category
		}
		if err := recordChangeWithin(ctx, tx, company, ticketID, "category_set", actorUserID, "", named); err != nil {
			return err
		}
		_, err = routeIfUnassignedWithin(ctx, tx, company, ticketID)
		return err
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" {
		return Refused, nil
	}
	return outcome, err
}

// routeIfUnassignedWithin routes an open, unassigned request with a
// category (its row locked) and queues the assignee's email.
func routeIfUnassignedWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, ticketID string) (bool, error) {
	var status string
	var assignee, category *string
	err := tx.QueryRow(ctx, `SELECT status, assigned_to_user_id, category FROM tickets WHERE company_id = $1 AND id = $2 FOR UPDATE`,
		company.String(), ticketID).Scan(&status, &assignee, &category)
	if err != nil || status != "open" || assignee != nil || category == nil {
		return false, ignoreNoRows(err)
	}
	expert, err := routeByCategory(ctx, tx, company, ticketID, *category)
	if err != nil || expert == "" {
		return false, err
	}
	return true, QueueAssignedEmailWithin(ctx, tx, company, ticketID, expert)
}

// recordChangeWithin writes one history row (actor "" = routing or the app).
func recordChangeWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, ticketID, kind, actorUserID, targetUserID string, category *string) error {
	const insert = `
		INSERT INTO ticket_activity (company_id, ticket_id, kind, actor_user_id, target_user_id, category)
		VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), $6)`
	_, err := tx.Exec(ctx, insert, company.String(), ticketID, kind, actorUserID, targetUserID, category)
	return err
}

// AddNote adds an internal note (encrypted for its company, request and
// note) in ONE statement that only writes when the request is this company's.
func AddNote(ctx context.Context, pool *database.Pool, company tenant.CompanyID, authorUserID, ticketID, noteID, bodyEncrypted string) (bool, error) {
	const insert = `
		INSERT INTO ticket_activity (id, company_id, ticket_id, kind, actor_user_id, body_encrypted, created_at)
		SELECT $3::uuid, tickets.company_id, tickets.id, 'note', $4, $5, clock_timestamp()
		FROM tickets WHERE tickets.company_id = $1 AND tickets.id = $2`
	tag, err := pool.Exec(ctx, insert, company.String(), ticketID, noteID, authorUserID, bodyEncrypted)
	return tag.RowsAffected() == 1, err
}

// CloseWithoutEmail solves an open request without emailing the customer
// (spam, a "thanks", a duplicate, a forged sender): no email is ever sent
// for it, and the history says so.
func CloseWithoutEmail(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, ticketID string) (bool, error) {
	closed := false
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		const update = `
			UPDATE tickets SET status = 'solved', solved_at = now(), solved_by_user_id = $3, solved_without_email = true
			WHERE company_id = $1 AND id = $2 AND status = 'open'`
		tag, err := tx.Exec(ctx, update, company.String(), ticketID, actorUserID)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		closed = true
		return recordChangeWithin(ctx, tx, company, ticketID, "closed_without_email", actorUserID, "", nil)
	})
	return closed, err
}

// Reopen opens a solved request again (owners), clearing who solved it and
// how; one whose assignee can no longer take tickets goes back to routing.
func Reopen(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, ticketID string) (string, error) {
	outcome := Changed
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		if role, err := team.RoleWithin(ctx, tx, company, actorUserID); err != nil || role != "owner" {
			outcome = NotAllowed
			return err
		}
		const reopen = `
			UPDATE tickets SET status = 'open', solved_at = NULL, solved_by_user_id = NULL, solved_without_email = false
			WHERE company_id = $1 AND id = $2 AND status = 'solved'
			RETURNING assigned_to_user_id`
		var assignee *string
		if err := tx.QueryRow(ctx, reopen, company.String(), ticketID).Scan(&assignee); err != nil {
			outcome = Refused
			return ignoreNoRows(err)
		}
		if err := recordChangeWithin(ctx, tx, company, ticketID, "reopened", actorUserID, "", nil); err != nil {
			return err
		}
		const takeOff = `
			UPDATE tickets SET assigned_to_user_id = NULL, assigned_automatically = NULL
			WHERE company_id = $1 AND id = $2 AND assigned_to_user_id IS NOT NULL
				AND NOT EXISTS (SELECT 1 FROM users WHERE company_id = $1 AND id = tickets.assigned_to_user_id AND email_verified AND deactivated_at IS NULL FOR SHARE)`
		tag, err := tx.Exec(ctx, takeOff, company.String(), ticketID)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		if err := recordChangeWithin(ctx, tx, company, ticketID, "unassigned", "", *assignee, nil); err != nil {
			return err
		}
		_, err = routeIfUnassignedWithin(ctx, tx, company, ticketID)
		return err
	})
	return outcome, err
}

func ignoreNoRows(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	return err
}
