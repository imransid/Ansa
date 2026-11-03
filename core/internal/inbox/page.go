package inbox

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/chat"
	"ansa/core/internal/database"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// Page is one conversation as its page shows it.
type Page struct {
	ID              string     `json:"id"`
	Channel         string     `json:"channel"`
	DisplayName     *string    `json:"displayName"`
	ExternalID      string     `json:"externalId"`
	HandledBy       string     `json:"handledBy"`
	TakenOverAt     *time.Time `json:"takenOverAt"`
	TakenOverByName *string    `json:"takenOverByName"`
	Important       bool       `json:"important"`
	// "If I haven't answered within N minutes" (step 51): when ansa answers
	// unless a person does first; nil while it isn't waiting, or while
	// something keeps it quiet then anyway (answersWhenDue).
	AssistantDueAt *time.Time `json:"assistantDueAt"`
	Entries        []Entry    `json:"entries"`
	// Its open requests, newest first (the newest one's actions: the tickets API).
	OpenTickets []TicketLine `json:"openTickets"`
	Activity    []Activity   `json:"activity"`
	// Only chats can be answered from ansa; why a reply can't go now, or "".
	CanReply     bool          `json:"canReply"`
	ReplyBlocked string        `json:"replyBlocked"`
	Orders       []PlacedOrder `json:"orders"`
}

// PlacedOrder is one of this customer's placed orders. Fulfilment
// ("delivery" or "pickup") words its "ready": on its way, or ready to pick up.
type PlacedOrder struct {
	Number     int    `json:"number"`
	Status     string `json:"status"`
	Fulfilment string `json:"fulfilment"`
	TotalCents int64  `json:"totalCents"`
	Currency   string `json:"currency"`
}

// ErrNotFound: no such conversation in this company.
var ErrNotFound = errors.New("inbox: no such conversation")

// answersWhenDue: the catch-up's run answers a conversation whose minutes
// are up only while nothing keeps ansa quiet there (the gate,
// internal/assistant/gate.go): not paused, not taken over, no request open.
const answersWhenDue = `conversations.handled_by = 'assistant'
	AND NOT EXISTS (SELECT 1 FROM assistant_settings WHERE assistant_settings.company_id = conversations.company_id AND assistant_settings.status = 'paused')
	AND NOT EXISTS (SELECT 1 FROM tickets WHERE tickets.company_id = conversations.company_id AND tickets.conversation_id = conversations.id AND tickets.status = 'open')`

// ReadPage reads one conversation of the company.
func ReadPage(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, conversationID string) (*Page, error) {
	const statement = `
		SELECT conversations.id, contacts.channel, contacts.display_name, contacts.external_id, conversations.handled_by,
			conversations.taken_over_at, taker.name, contacts.important
		FROM conversations
		JOIN contacts ON contacts.id = conversations.contact_id AND contacts.company_id = conversations.company_id
		LEFT JOIN users AS taker ON taker.id = conversations.taken_over_by_user_id AND taker.company_id = conversations.company_id
		WHERE conversations.company_id = $1 AND conversations.id = $2`
	var p Page
	err := pool.QueryRow(ctx, statement, company.String(), conversationID).Scan(&p.ID, &p.Channel, &p.DisplayName, &p.ExternalID, &p.HandledBy, &p.TakenOverAt, &p.TakenOverByName, &p.Important)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if p.AssistantDueAt, err = answersAt(ctx, pool, company, p.ID); err != nil {
		return nil, err
	}
	if p.Entries, err = entries(ctx, pool, box, company, p.ID); err != nil {
		return nil, err
	}
	if p.OpenTickets, err = OpenTickets(ctx, pool, company, p.ID); err != nil {
		return nil, err
	}
	if p.Activity, err = ListActivity(ctx, pool, company, p.ID, 20); err != nil {
		return nil, err
	}
	if p.Orders, err = placedOrders(ctx, pool, company, p.ID); err != nil {
		return nil, err
	}
	p.CanReply, p.ReplyBlocked, err = replyState(ctx, pool, company, p.ID)
	return &p, err
}

// answersAt is when ansa answers unless a person does first: the wait's
// due time, or nil while it isn't waiting or would stay quiet then anyway.
func answersAt(ctx context.Context, pool *database.Pool, company tenant.CompanyID, conversationID string) (*time.Time, error) {
	// Built from the fixed text above, never input.
	statement := `SELECT assistant_due_at FROM conversations WHERE conversations.company_id = $1 AND conversations.id = $2 AND ` + answersWhenDue
	var due *time.Time
	err := pool.QueryRow(ctx, statement, company.String(), conversationID).Scan(&due)
	return due, ignoreNoRows(err)
}

// replyState reads the same rules a reply checks (chat.RouteWithin), so the
// page says it before anyone types. Nothing is written.
func replyState(ctx context.Context, pool *database.Pool, company tenant.CompanyID, conversationID string) (bool, string, error) {
	refusal := ""
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		var err error
		_, refusal, err = chat.RouteWithin(ctx, tx, company, conversationID)
		return err
	})
	if refusal == chat.RefusedNotChat || refusal == chat.RefusedNotFound {
		return false, "", err
	}
	return true, refusal, err
}

func placedOrders(ctx context.Context, pool *database.Pool, company tenant.CompanyID, conversationID string) ([]PlacedOrder, error) {
	const statement = `
		SELECT order_number, status, fulfilment, total_cents, currency FROM orders
		WHERE company_id = $1 AND conversation_id = $2 AND order_number IS NOT NULL
		ORDER BY created_at DESC LIMIT 3`
	rows, err := pool.Query(ctx, statement, company.String(), conversationID)
	if err != nil {
		return nil, err
	}
	list := []PlacedOrder{}
	for rows.Next() {
		var o PlacedOrder
		if err := rows.Scan(&o.Number, &o.Status, &o.Fulfilment, &o.TotalCents, &o.Currency); err != nil {
			return nil, err
		}
		list = append(list, o)
	}
	return list, rows.Err()
}

func ignoreNoRows(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	return err
}
