package outbox

import (
	"context"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// Customer "solved" emails that never reached the customer (the old
// db/undelivered-emails.ts): the Emails page's short list and Home's notice,
// since otherwise they only show on each request's page, which nobody opens
// again. Failed; still not sent once no delivery is under way; or reported
// by Resend as bounced, suppressed or failed ("complained" was delivered).
// Only each request's CURRENT solve: an earlier solve's email, of a request
// reopened since, is someone's work in progress.
const undelivered = `(outgoing_emails.status = 'failed'
	OR (outgoing_emails.status IN ('pending', 'sending') AND NOT (
		(outgoing_emails.status = 'sending' AND outgoing_emails.last_attempt_at >= now() - interval '10 minutes')
		OR (outgoing_emails.status = 'pending' AND outgoing_emails.created_at >= now() - interval '10 minutes' AND COALESCE(outgoing_emails.last_error, '') <> 'daily_limit')))
	OR (outgoing_emails.status = 'sent' AND outgoing_emails.delivery_problem IN ('bounced', 'suppressed', 'failed')))
	AND EXISTS (SELECT 1 FROM tickets WHERE tickets.company_id = outgoing_emails.company_id AND tickets.id = outgoing_emails.ticket_id
		AND tickets.status = 'solved' AND tickets.solved_without_email = false AND outgoing_emails.created_at >= tickets.solved_at)`

// Undelivered is one such email.
type Undelivered struct {
	EmailID              string    `json:"emailId"`
	TicketNumber         int       `json:"ticketNumber"`
	ToEmail              string    `json:"toEmail"`
	Status               string    `json:"status"`
	DeliveryProblem      *string   `json:"deliveryProblem"`
	HeldBackByDailyLimit bool      `json:"heldBackByDailyLimit"`
	ChangedAt            time.Time `json:"changedAt"`
}

// ListUndelivered is the company's newest 20, most recently changed first,
// and how many there are in all.
func ListUndelivered(ctx context.Context, pool *database.Pool, company tenant.CompanyID) ([]Undelivered, int, error) {
	statement := `
		SELECT outgoing_emails.id, tickets.ticket_number, outgoing_emails.to_email, outgoing_emails.status::text, outgoing_emails.delivery_problem::text,
			COALESCE(outgoing_emails.last_error, '') = 'daily_limit', outgoing_emails.updated_at
		FROM outgoing_emails
		JOIN tickets ON tickets.company_id = outgoing_emails.company_id AND tickets.id = outgoing_emails.ticket_id
		WHERE ` + undelivered + `
			AND outgoing_emails.company_id = $1
		ORDER BY outgoing_emails.updated_at DESC, outgoing_emails.id DESC LIMIT 20`
	rows, err := pool.Query(ctx, statement, company.String())
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	list := []Undelivered{}
	for rows.Next() {
		var u Undelivered
		if err := rows.Scan(&u.EmailID, &u.TicketNumber, &u.ToEmail, &u.Status, &u.DeliveryProblem, &u.HeldBackByDailyLimit, &u.ChangedAt); err != nil {
			return nil, 0, err
		}
		list = append(list, u)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	total, err := CountUndelivered(ctx, pool, company)
	return list, total, err
}

// CountUndelivered is how many there are (Home's notice).
func CountUndelivered(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (int, error) {
	var total int
	err := pool.QueryRow(ctx, `SELECT count(*) FROM outgoing_emails WHERE outgoing_emails.company_id = $1 AND `+undelivered, company.String()).Scan(&total)
	return total, err
}
