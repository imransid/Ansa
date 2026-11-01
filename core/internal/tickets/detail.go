package tickets

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// Detail is one request as its page shows it.
type Detail struct {
	ID                     string     `json:"id"`
	Number                 int        `json:"number"`
	Subject                string     `json:"subject"`
	Description            string     `json:"description"`
	Status                 string     `json:"status"`
	Channel                string     `json:"channel"`
	Category               *string    `json:"category"`
	CustomerName           *string    `json:"customerName"`
	CustomerEmail          *string    `json:"customerEmail"`
	CustomerPhone          *string    `json:"customerPhone"`
	AssignedToUserID       *string    `json:"assignedToUserId"`
	AssigneeName           *string    `json:"assigneeName"`
	AssignedAutomatically  *bool      `json:"assignedAutomatically"`
	SolvedAt               *time.Time `json:"solvedAt"`
	SolvedByName           *string    `json:"solvedByName"`
	SolvedWithoutEmail     bool       `json:"solvedWithoutEmail"`
	CustomerEmailSetByName *string    `json:"customerEmailSetByName"`
	CustomerEmailSetAt     *time.Time `json:"customerEmailSetAt"`
	ConversationID         *string    `json:"conversationId"`
	CallID                 *string    `json:"callId"`
	CreatedAt              time.Time  `json:"createdAt"`
	History                []History  `json:"history"`
	// The page shows the newest 200 entries: older ones exist.
	OlderEntriesHidden bool `json:"olderEntriesHidden"`
}

// History is one entry of a request's history: a change, or a note (decrypted).
type History struct {
	ID        string  `json:"id"`
	Kind      string  `json:"kind"`
	ActorName *string `json:"actorName"`
	// Who did it and who it was about (the wording tells "took it" from
	// "gave it to Ana"); nil = routing or ansa itself.
	ActorUserID  *string `json:"actorUserId"`
	TargetUserID *string `json:"targetUserId"`
	// A note that could not be decrypted (said, never shown as empty).
	NoteUnreadable bool      `json:"noteUnreadable"`
	TargetName     *string   `json:"targetName"`
	Category       *string   `json:"category"`
	Note           *string   `json:"note"`
	CreatedAt      time.Time `json:"createdAt"`
}

// ErrNoTicket: no such request in this company.
var ErrNoTicket = errors.New("tickets: no such request")

// NoteContext ties a note to its company, request and note.
func NoteContext(company tenant.CompanyID, ticketID, noteID string) string {
	return "ticket-note:" + company.String() + ":" + ticketID + ":" + noteID
}

// ReadDetail reads one request by its number, with the newest 200 history
// entries, oldest first.
func ReadDetail(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, number int) (*Detail, error) {
	const statement = `
		SELECT tickets.id, tickets.ticket_number, tickets.subject, tickets.description, tickets.status, tickets.channel, tickets.category,
			tickets.customer_name, tickets.customer_email, tickets.customer_phone, tickets.assigned_to_user_id, assignee.name,
			tickets.assigned_automatically, tickets.solved_at, solver.name, tickets.solved_without_email, setter.name,
			tickets.customer_email_set_at, tickets.conversation_id, tickets.call_id, tickets.created_at
		FROM tickets
		LEFT JOIN users AS assignee ON assignee.id = tickets.assigned_to_user_id AND assignee.company_id = tickets.company_id
		LEFT JOIN users AS solver ON solver.id = tickets.solved_by_user_id AND solver.company_id = tickets.company_id
		LEFT JOIN users AS setter ON setter.id = tickets.customer_email_set_by_user_id AND setter.company_id = tickets.company_id
		WHERE tickets.company_id = $1 AND tickets.ticket_number = $2`
	var d Detail
	err := pool.QueryRow(ctx, statement, company.String(), number).Scan(&d.ID, &d.Number, &d.Subject, &d.Description, &d.Status, &d.Channel,
		&d.Category, &d.CustomerName, &d.CustomerEmail, &d.CustomerPhone, &d.AssignedToUserID, &d.AssigneeName, &d.AssignedAutomatically,
		&d.SolvedAt, &d.SolvedByName, &d.SolvedWithoutEmail, &d.CustomerEmailSetByName, &d.CustomerEmailSetAt, &d.ConversationID, &d.CallID, &d.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoTicket
	}
	if err != nil {
		return nil, err
	}
	d.History, err = history(ctx, pool, box, company, d.ID)
	if len(d.History) > historyShown {
		d.History, d.OlderEntriesHidden = d.History[len(d.History)-historyShown:], true
	}
	return &d, err
}

func history(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, ticketID string) ([]History, error) {
	const statement = `
		SELECT ticket_activity.id, ticket_activity.kind, actor.name, target.name, ticket_activity.category, ticket_activity.body_encrypted,
			ticket_activity.created_at, ticket_activity.actor_user_id, ticket_activity.target_user_id
		FROM ticket_activity
		LEFT JOIN users AS actor ON actor.id = ticket_activity.actor_user_id AND actor.company_id = ticket_activity.company_id
		LEFT JOIN users AS target ON target.id = ticket_activity.target_user_id AND target.company_id = ticket_activity.company_id
		WHERE ticket_activity.company_id = $1 AND ticket_activity.ticket_id = $2
		ORDER BY ticket_activity.created_at DESC, ticket_activity.id DESC LIMIT $3`
	rows, err := pool.Query(ctx, statement, company.String(), ticketID, historyShown+1)
	if err != nil {
		return nil, err
	}
	var newestFirst []History
	for rows.Next() {
		var h History
		var body *string
		if err := rows.Scan(&h.ID, &h.Kind, &h.ActorName, &h.TargetName, &h.Category, &body, &h.CreatedAt, &h.ActorUserID, &h.TargetUserID); err != nil {
			return nil, err
		}
		if body != nil {
			text, err := box.Decrypt(*body, NoteContext(company, ticketID, h.ID))
			if err != nil {
				h.NoteUnreadable = true
			} else {
				h.Note = &text
			}
		}
		newestFirst = append(newestFirst, h)
	}
	oldestFirst := make([]History, 0, len(newestFirst))
	for i := len(newestFirst) - 1; i >= 0; i-- {
		oldestFirst = append(oldestFirst, newestFirst[i])
	}
	return oldestFirst, rows.Err()
}

// The page shows a request's newest 200 history entries.
const historyShown = 200

// Person is someone a request can be given to (confirmed, not removed).
type Person struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

// AssigneeChoices are the people who can take requests, by name.
func AssigneeChoices(ctx context.Context, pool *database.Pool, company tenant.CompanyID) ([]Person, error) {
	rows, err := pool.Query(ctx, `SELECT id, name, email FROM users WHERE company_id = $1 AND email_verified AND deactivated_at IS NULL ORDER BY name, created_at`, company.String())
	if err != nil {
		return nil, err
	}
	people := []Person{}
	for rows.Next() {
		var p Person
		if err := rows.Scan(&p.ID, &p.Name, &p.Email); err != nil {
			return nil, err
		}
		people = append(people, p)
	}
	return people, rows.Err()
}

// ActiveCategories are the company's category names (an owner's settings).
func ActiveCategories(ctx context.Context, pool *database.Pool, company tenant.CompanyID) ([]string, error) {
	rows, err := pool.Query(ctx, `SELECT name FROM categories WHERE company_id = $1 AND archived_at IS NULL ORDER BY name`, company.String())
	if err != nil {
		return nil, err
	}
	names := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, rows.Err()
}
