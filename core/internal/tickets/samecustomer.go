package tickets

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// SameCustomer is another open request of the same customer (the request
// page lists them: one customer, one expert).
type SameCustomer struct {
	TicketNumber int       `json:"ticketNumber"`
	Subject      string    `json:"subject"`
	AssigneeName *string   `json:"assigneeName"`
	CreatedAt    time.Time `json:"createdAt"`
}

// OtherOpenFromSameCustomer are the newest 20 other open requests with the
// same phone digits or the same email address; none when this request holds
// nothing that tells customers apart (a hidden caller's number counts as none).
func OtherOpenFromSameCustomer(ctx context.Context, pool *database.Pool, company tenant.CompanyID, ticketID string) ([]SameCustomer, error) {
	var phone, email *string
	err := pool.QueryRow(ctx, `SELECT customer_phone, customer_email FROM tickets WHERE company_id = $1 AND id = $2`, company.String(), ticketID).Scan(&phone, &email)
	if errors.Is(err, pgx.ErrNoRows) {
		return []SameCustomer{}, nil
	}
	if err != nil {
		return nil, err
	}
	digits, address := "", ""
	if phone != nil {
		digits = CustomerPhoneDigits(*phone)
	}
	if email != nil {
		address = strings.ToLower(*email)
	}
	list := []SameCustomer{}
	if digits == "" && address == "" {
		return list, nil
	}
	const statement = `
		SELECT tickets.ticket_number, tickets.subject, users.name, tickets.created_at
		FROM tickets
		LEFT JOIN users ON users.id = tickets.assigned_to_user_id AND users.company_id = tickets.company_id
		WHERE tickets.company_id = $1 AND tickets.id <> $2 AND tickets.status = 'open'
			AND (($3 <> '' AND regexp_replace(tickets.customer_phone, '[^0-9]', '', 'g') = $3) OR ($4 <> '' AND lower(tickets.customer_email) = $4))
		ORDER BY tickets.ticket_number DESC LIMIT 20`
	rows, err := pool.Query(ctx, statement, company.String(), ticketID, digits, address)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var s SameCustomer
		if err := rows.Scan(&s.TicketNumber, &s.Subject, &s.AssigneeName, &s.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, s)
	}
	return list, rows.Err()
}

// routeToSameCustomerWithin gives a new request to whoever has the same
// customer's newest other open request (sameCustomerAssignee), with its
// "routed" row naming no category; "" when nobody has one.
func routeToSameCustomerWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, ticketID, digits, email string) (string, error) {
	expert, err := sameCustomerAssignee(ctx, tx, company, ticketID, digits, email)
	if err != nil || expert == "" {
		return "", err
	}
	const assign = `
		UPDATE tickets SET assigned_to_user_id = $3, assigned_automatically = true, routed_to_user_id = COALESCE(routed_to_user_id, $3)
		WHERE company_id = $1 AND id = $2 AND assigned_to_user_id IS NULL`
	if _, err := tx.Exec(ctx, assign, company.String(), ticketID, expert); err != nil {
		return "", err
	}
	return expert, recordChangeWithin(ctx, tx, company, ticketID, "routed", "", expert, nil)
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
