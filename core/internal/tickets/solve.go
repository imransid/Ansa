package tickets

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/jobs"
	"ansa/core/internal/tenant"
)

// DeliverJobKind delivers one queued customer email (the outbox's row).
const DeliverJobKind = "customer_email.deliver"

// DeliverPayload names the outbox row.
type DeliverPayload struct {
	EmailID string `json:"emailId"`
}

// Solve marks an open request solved and, when the customer has an email
// address, queues the "solved" email in the SAME transaction (an outbox row
// and its delivery job): either both happen or neither. confirmedEmail is
// the address the person saw ("" = none): the request must still have
// exactly it, so the email never goes to an address they didn't see.
// Returns whether it was solved and whether an email was queued.
func Solve(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, ticketID, confirmedEmail string) (bool, bool, error) {
	solved, queued := false, false
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		const update = `
			UPDATE tickets SET status = 'solved', solved_at = now(), solved_by_user_id = $3, solved_without_email = false
			WHERE company_id = $1 AND id = $2 AND status = 'open' AND COALESCE(customer_email, '') = $4
			RETURNING customer_email`
		var address *string
		err := tx.QueryRow(ctx, update, company.String(), ticketID, actorUserID, confirmedEmail).Scan(&address)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		solved = true
		if err := recordChangeWithin(ctx, tx, company, ticketID, "solved", actorUserID, "", nil); err != nil {
			return err
		}
		if address == nil {
			return nil
		}
		var emailID string
		const queue = `INSERT INTO outgoing_emails (company_id, ticket_id, kind, to_email) VALUES ($1, $2, 'ticket_solved', $3) RETURNING id`
		if err := tx.QueryRow(ctx, queue, company.String(), ticketID, *address).Scan(&emailID); err != nil {
			return err
		}
		queued = true
		// Tried three times on its own within minutes (safe: the row id is
		// the idempotency key); Retry on the page after that.
		_, err = jobs.EnqueueWithin(ctx, tx, company, jobs.NewJob{Kind: DeliverJobKind, Payload: DeliverPayload{EmailID: emailID}, MaxAttempts: 3})
		return err
	})
	return solved, queued, err
}

// SetCustomerEmail sets (or changes) the customer's email and records who
// entered it and when (also the same address again: who entered it last).
// The address itself stays out of the history. Emails already queued keep
// the address they were queued with.
func SetCustomerEmail(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, ticketID, address string) (bool, error) {
	set := false
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		const update = `
			UPDATE tickets SET customer_email = $3, customer_email_set_by_user_id = $4, customer_email_set_at = now()
			WHERE company_id = $1 AND id = $2`
		tag, err := tx.Exec(ctx, update, company.String(), ticketID, address, actorUserID)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		set = true
		return recordChangeWithin(ctx, tx, company, ticketID, "customer_email_set", actorUserID, "", nil)
	})
	return set, err
}

// Edit is "Edit subject or customer name": each field with what the editor
// opened with. Only a field the person changed is written, so a teammate's
// change to the other field stays.
type Edit struct {
	Subject, OriginalSubject           string
	CustomerName, OriginalCustomerName string
}

// EditDetails writes the changed fields (the row locked; one history row each).
func EditDetails(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, ticketID string, e Edit) (bool, error) {
	found := false
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT true FROM tickets WHERE company_id = $1 AND id = $2 FOR NO KEY UPDATE`, company.String(), ticketID).Scan(&exists); err != nil {
			return ignoreNoRows(err)
		}
		found = true
		if e.Subject != e.OriginalSubject {
			if _, err := tx.Exec(ctx, `UPDATE tickets SET subject = $3 WHERE company_id = $1 AND id = $2`, company.String(), ticketID, e.Subject); err != nil {
				return err
			}
			if err := recordChangeWithin(ctx, tx, company, ticketID, "subject_changed", actorUserID, "", nil); err != nil {
				return err
			}
		}
		if e.CustomerName != e.OriginalCustomerName {
			if _, err := tx.Exec(ctx, `UPDATE tickets SET customer_name = NULLIF($3, '') WHERE company_id = $1 AND id = $2`, company.String(), ticketID, e.CustomerName); err != nil {
				return err
			}
			return recordChangeWithin(ctx, tx, company, ticketID, "customer_name_changed", actorUserID, "", nil)
		}
		return nil
	})
	return found, err
}
