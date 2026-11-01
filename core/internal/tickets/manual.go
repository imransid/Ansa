package tickets

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// What a carrier sends instead of a hidden caller's number (Twilio spells a
// word on the keypad: ANONYMOUS, RESTRICTED, UNAVAILABLE, UNKNOWN, BLOCKED):
// every hidden caller gets the same one, so these never count as a customer.
var hiddenCallerPlaceholders = map[string]bool{"266696687": true, "7378742833": true, "86282452253": true, "8656696": true, "2562533": true}

var notDigits = regexp.MustCompile(`\D`)

// CustomerPhoneDigits are the digits that tell a customer apart, or ""
// (missing, fewer than 7, a hidden caller's placeholder, one digit repeated).
func CustomerPhoneDigits(phone string) string {
	digits := notDigits.ReplaceAllString(phone, "")
	if len(digits) < 7 || hiddenCallerPlaceholders[digits] || strings.Count(digits, digits[:1]) == len(digits) {
		return ""
	}
	return digits
}

// NewRequest is a request a person types in.
type NewRequest struct {
	Subject, Description               string
	CustomerName, CustomerEmail, Phone string
	CategoryID                         string
}

// CreateManual saves a typed-in request (channel "manual") with the next
// number, its "created" history row, then routing as every new request:
// the same customer's open request's expert first, else by category. The
// category is followed by its id (renamed = followed; archived or another
// company's = none). A typed customer email is recorded as entered by its
// creator. Returns the new number.
func CreateManual(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, r NewRequest) (int, error) {
	var number int
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `UPDATE companies SET last_ticket_number = last_ticket_number + 1 WHERE id = $1 RETURNING last_ticket_number`, company.String()).Scan(&number); err != nil {
			return err
		}
		category, err := currentCategoryName(ctx, tx, company, r.CategoryID)
		if err != nil {
			return err
		}
		const insert = `
			INSERT INTO tickets (company_id, ticket_number, subject, description, channel, category, customer_name, customer_email, customer_phone,
				customer_email_set_by_user_id, customer_email_set_at)
			VALUES ($1, $2, $3, $4, 'manual', $5, NULLIF($6, ''), NULLIF($7, ''), NULLIF($8, ''),
				CASE WHEN $7 = '' THEN NULL ELSE $9 END, CASE WHEN $7 = '' THEN NULL ELSE now() END)
			RETURNING id`
		var id string
		if err := tx.QueryRow(ctx, insert, company.String(), number, r.Subject, r.Description, category, r.CustomerName, r.CustomerEmail, r.Phone, actorUserID).Scan(&id); err != nil {
			return err
		}
		if err := recordChangeWithin(ctx, tx, company, id, "created", actorUserID, "", nil); err != nil {
			return err
		}
		return routeNewWithin(ctx, tx, company, id, actorUserID, r)
	})
	return number, err
}

// routeNewWithin: the same customer's newest open request with someone who
// can take requests goes first (its "routed" row names no category), else
// routing by category. Whoever gets it is emailed (not its own creator).
func routeNewWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, ticketID, actorUserID string, r NewRequest) error {
	expert, err := sameCustomerAssignee(ctx, tx, company, ticketID, CustomerPhoneDigits(r.Phone), strings.ToLower(r.CustomerEmail))
	if err != nil {
		return err
	}
	if expert != "" {
		const assign = `
			UPDATE tickets SET assigned_to_user_id = $3, assigned_automatically = true, routed_to_user_id = COALESCE(routed_to_user_id, $3)
			WHERE company_id = $1 AND id = $2 AND assigned_to_user_id IS NULL`
		if _, err := tx.Exec(ctx, assign, company.String(), ticketID, expert); err != nil {
			return err
		}
		if err := recordChangeWithin(ctx, tx, company, ticketID, "routed", "", expert, nil); err != nil {
			return err
		}
	} else {
		var category *string
		if err := tx.QueryRow(ctx, `SELECT category FROM tickets WHERE company_id = $1 AND id = $2`, company.String(), ticketID).Scan(&category); err != nil || category == nil {
			return err
		}
		if expert, err = routeByCategory(ctx, tx, company, ticketID, *category); err != nil || expert == "" {
			return err
		}
	}
	if expert == actorUserID {
		return nil
	}
	return QueueAssignedEmailWithin(ctx, tx, company, ticketID, expert)
}

// sameCustomerAssignee is who has this customer's newest other open request
// (the same phone digits or the same email), if they can take requests.
func sameCustomerAssignee(ctx context.Context, tx database.Tx, company tenant.CompanyID, ticketID, digits, email string) (string, error) {
	if digits == "" && email == "" {
		return "", nil
	}
	const statement = `
		SELECT users.id FROM tickets
		JOIN users ON users.id = tickets.assigned_to_user_id AND users.company_id = tickets.company_id
		WHERE tickets.company_id = $1 AND tickets.id <> $2 AND tickets.status = 'open' AND users.email_verified AND users.deactivated_at IS NULL
			AND (($3 <> '' AND regexp_replace(tickets.customer_phone, '[^0-9]', '', 'g') = $3) OR ($4 <> '' AND lower(tickets.customer_email) = $4))
		ORDER BY tickets.ticket_number DESC LIMIT 1`
	var expert string
	err := tx.QueryRow(ctx, statement, company.String(), ticketID, digits, email).Scan(&expert)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return expert, err
}

// NewEmailRequest is a request made from a received email. The category
// is the AI's choice by name (an active one, read now: renamed or archived
// meanwhile = none).
type NewEmailRequest struct {
	Subject, Description, CategoryID, CategoryName string
	CustomerName, CustomerEmail                    string
}

// CreateEmailTicketWithin numbers and saves an email's request (channel
// "email") inside the caller's transaction, which took the company row
// lock first, and routes it as every new request. Returns its id.
func CreateEmailTicketWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, r NewEmailRequest) (string, error) {
	var number int
	if err := tx.QueryRow(ctx, `UPDATE companies SET last_ticket_number = last_ticket_number + 1 WHERE id = $1 RETURNING last_ticket_number`, company.String()).Scan(&number); err != nil {
		return "", err
	}
	category, err := currentCategoryName(ctx, tx, company, r.CategoryID)
	if err != nil {
		return "", err
	}
	if category == nil && r.CategoryName != "" {
		var name string
		err := tx.QueryRow(ctx, `SELECT name FROM categories WHERE company_id = $1 AND name = $2 AND archived_at IS NULL FOR KEY SHARE`, company.String(), r.CategoryName).Scan(&name)
		if err == nil {
			category = &name
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
	}
	const insert = `
		INSERT INTO tickets (company_id, ticket_number, subject, description, channel, category, customer_name, customer_email)
		VALUES ($1, $2, $3, $4, 'email', $5, NULLIF($6, ''), NULLIF($7, ''))
		RETURNING id`
	var id string
	if err := tx.QueryRow(ctx, insert, company.String(), number, r.Subject, r.Description, category, r.CustomerName, r.CustomerEmail).Scan(&id); err != nil {
		return "", err
	}
	return id, routeNewWithin(ctx, tx, company, id, "", NewRequest{CustomerEmail: r.CustomerEmail})
}

// NewCallRequest is the request of a call a person must follow up.
type NewCallRequest struct {
	Subject, Description, CategoryID, CustomerPhone, CallID string
	// "" = made by the AI's decision; else who escalated it ("escalated").
	EscalatedBy string
}

// CreateCallTicketWithin numbers and saves a call's request (channel
// "phone", one per call: tickets.call_id is unique) inside the caller's
// transaction, which locked the call's row first; it joins the call's
// conversation, and is routed as every new request (the same caller's open
// request's expert first, else by category), its assignee emailed after
// commit. The category is followed by its id. Returns its id.
func CreateCallTicketWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, r NewCallRequest) (string, error) {
	var number int
	if err := tx.QueryRow(ctx, `UPDATE companies SET last_ticket_number = last_ticket_number + 1 WHERE id = $1 RETURNING last_ticket_number`, company.String()).Scan(&number); err != nil {
		return "", err
	}
	category, err := currentCategoryName(ctx, tx, company, r.CategoryID)
	if err != nil {
		return "", err
	}
	const insert = `
		INSERT INTO tickets (company_id, ticket_number, subject, description, channel, category, customer_phone, call_id, conversation_id)
		VALUES ($1, $2, $3, $4, 'phone', $5, NULLIF($6, ''), $7, (SELECT conversation_id FROM calls WHERE company_id = $1 AND id = $7))
		RETURNING id`
	var id string
	if err := tx.QueryRow(ctx, insert, company.String(), number, r.Subject, r.Description, category, r.CustomerPhone, r.CallID).Scan(&id); err != nil {
		return "", err
	}
	if r.EscalatedBy != "" {
		if err := recordChangeWithin(ctx, tx, company, id, "escalated", r.EscalatedBy, "", nil); err != nil {
			return "", err
		}
	}
	return id, routeNewWithin(ctx, tx, company, id, r.EscalatedBy, NewRequest{Phone: r.CustomerPhone})
}
