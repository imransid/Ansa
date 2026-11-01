// Package tickets makes and routes requests ("Needs you"), as the old
// db/ticket-creation.ts and db/routing.ts. Every function runs inside the
// caller's transaction, which took the company row lock FIRST
// (LockCompanyWithin): numbering and routing then run one at a time per
// company, and two routings can't both pick the same "least busy" expert.
package tickets

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// NewChatTicket is a request the assistant opens in a conversation.
type NewChatTicket struct {
	Subject        string
	Description    string
	CategoryID     string
	CustomerName   *string
	ConversationID string
}

// Created is the new ticket and who routing gave it to ("" for nobody).
type Created struct {
	ID         string
	Number     int
	AssigneeID string
}

// LockCompanyWithin takes the company row lock every numbering and routing
// transaction takes first (the old lockCompanyRow).
func LockCompanyWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID) error {
	_, err := tx.Exec(ctx, `SELECT id FROM companies WHERE id = $1 FOR NO KEY UPDATE`, company.String())
	return err
}

// CreateChatTicketWithin numbers, saves and routes a chat request. The
// category is followed by its id (renamed meanwhile = the new name; archived
// or another company's = none).
func CreateChatTicketWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, input NewChatTicket) (Created, error) {
	var number int
	if err := tx.QueryRow(ctx, `UPDATE companies SET last_ticket_number = last_ticket_number + 1 WHERE id = $1 RETURNING last_ticket_number`, company.String()).Scan(&number); err != nil {
		return Created{}, err
	}
	category, err := currentCategoryName(ctx, tx, company, input.CategoryID)
	if err != nil {
		return Created{}, err
	}
	const insert = `
		INSERT INTO tickets (company_id, ticket_number, subject, description, channel, category, customer_name, conversation_id)
		VALUES ($1, $2, $3, $4, 'chat', $5, $6, $7)
		RETURNING id`
	var id string
	if err := tx.QueryRow(ctx, insert, company.String(), number, input.Subject, input.Description, category, input.CustomerName, input.ConversationID).Scan(&id); err != nil {
		return Created{}, err
	}
	created := Created{ID: id, Number: number}
	if category == nil {
		return created, nil
	}
	created.AssigneeID, err = routeByCategory(ctx, tx, company, id, *category)
	return created, err
}

func currentCategoryName(ctx context.Context, tx database.Tx, company tenant.CompanyID, categoryID string) (*string, error) {
	if categoryID == "" {
		return nil, nil
	}
	var name string
	err := tx.QueryRow(ctx, `SELECT name FROM categories WHERE company_id = $1 AND id = $2 AND archived_at IS NULL FOR KEY SHARE`, company.String(), categoryID).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &name, err
}

// routeByCategory gives the ticket to the expert who handles its category,
// can take tickets (confirmed, not removed) and has the fewest open tickets
// (ties: who joined first), and writes the "routed" history row.
func routeByCategory(ctx context.Context, tx database.Tx, company tenant.CompanyID, ticketID, category string) (string, error) {
	const pick = `
		SELECT users.id FROM user_categories
		JOIN categories ON categories.id = user_categories.category_id AND categories.company_id = user_categories.company_id
		JOIN users ON users.id = user_categories.user_id AND users.company_id = user_categories.company_id
		LEFT JOIN tickets ON tickets.assigned_to_user_id = users.id AND tickets.company_id = users.company_id AND tickets.status = 'open'
		WHERE user_categories.company_id = $1 AND categories.name = $2 AND categories.archived_at IS NULL
			AND users.email_verified AND users.deactivated_at IS NULL
		GROUP BY users.id, users.created_at
		ORDER BY count(tickets.id), users.created_at
		LIMIT 1`
	var expert string
	err := tx.QueryRow(ctx, pick, company.String(), category).Scan(&expert)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	const assign = `
		UPDATE tickets SET assigned_to_user_id = $3, assigned_automatically = true, routed_to_user_id = COALESCE(routed_to_user_id, $3)
		WHERE company_id = $1 AND id = $2 AND assigned_to_user_id IS NULL
			AND EXISTS (SELECT 1 FROM users WHERE users.company_id = $1 AND users.id = $3 AND users.email_verified AND users.deactivated_at IS NULL)`
	tag, err := tx.Exec(ctx, assign, company.String(), ticketID, expert)
	if err != nil || tag.RowsAffected() == 0 {
		return "", err
	}
	const history = `INSERT INTO ticket_activity (company_id, ticket_id, kind, target_user_id, category) VALUES ($1, $2, 'routed', $3, $4)`
	if _, err := tx.Exec(ctx, history, company.String(), ticketID, expert, category); err != nil {
		return "", err
	}
	return expert, nil
}
