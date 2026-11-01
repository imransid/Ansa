package inbox

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/chat"
	"ansa/core/internal/conversations"
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
	Entries         []Entry    `json:"entries"`
	// Its open requests, newest first (the newest one's actions: the tickets API).
	OpenTickets []TicketLine `json:"openTickets"`
	Activity    []Activity   `json:"activity"`
	// Only chats can be answered from ansa; why a reply can't go now, or "".
	CanReply     bool          `json:"canReply"`
	ReplyBlocked string        `json:"replyBlocked"`
	Orders       []PlacedOrder `json:"orders"`
}

// Entry is a chat message (decrypted), or a call or an email linked to the
// conversation (their content stays on their own pages).
type Entry struct {
	ID         string    `json:"id"`
	Author     string    `json:"author"`
	AuthorName *string   `json:"authorName"`
	CreatedAt  time.Time `json:"createdAt"`
	SendStatus *string   `json:"sendStatus"`
	SendError  *string   `json:"sendError"`
	Text       *string   `json:"text"`
	Unreadable bool      `json:"unreadable"`
	Call       *Call     `json:"call"`
	Email      *Email    `json:"email"`
}

// Call is a phone call linked to a conversation.
type Call struct {
	ID        string     `json:"id"`
	StartedAt *time.Time `json:"startedAt"`
	AIOutcome *string    `json:"aiOutcome"`
}

// Email is a received email linked to a conversation.
type Email struct {
	Subject  *string `json:"subject"`
	TicketID *string `json:"ticketId"`
}

// PlacedOrder is one of this customer's placed orders.
type PlacedOrder struct {
	Number     int    `json:"number"`
	Status     string `json:"status"`
	TotalCents int64  `json:"totalCents"`
	Currency   string `json:"currency"`
}

// ErrNotFound: no such conversation in this company.
var ErrNotFound = errors.New("inbox: no such conversation")

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

// entries are the newest 200 entries, oldest first.
func entries(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, conversationID string) ([]Entry, error) {
	const statement = `
		SELECT messages.id, messages.author, author.name, messages.created_at, messages.send_status, messages.send_error, messages.body_encrypted,
			calls.id, calls.started_at, calls.ai_outcome, inbound_emails.id, inbound_emails.subject_encrypted, inbound_emails.ticket_id
		FROM messages
		LEFT JOIN users AS author ON author.id = messages.author_user_id AND author.company_id = messages.company_id
		LEFT JOIN calls ON calls.id = messages.call_id AND calls.company_id = messages.company_id
		LEFT JOIN inbound_emails ON inbound_emails.id = messages.inbound_email_id AND inbound_emails.company_id = messages.company_id
		WHERE messages.company_id = $1 AND messages.conversation_id = $2
		ORDER BY messages.created_at DESC LIMIT 200`
	rows, err := pool.Query(ctx, statement, company.String(), conversationID)
	if err != nil {
		return nil, err
	}
	var newestFirst []Entry
	for rows.Next() {
		var e Entry
		var body, callID, emailID, subject, outcome *string
		var callStarted *time.Time
		var ticketID *string
		if err := rows.Scan(&e.ID, &e.Author, &e.AuthorName, &e.CreatedAt, &e.SendStatus, &e.SendError, &body, &callID, &callStarted, &outcome, &emailID, &subject, &ticketID); err != nil {
			return nil, err
		}
		if body != nil {
			if text, err := box.Decrypt(*body, conversations.MessageContext(company, e.ID)); err == nil {
				e.Text = &text
			} else {
				e.Unreadable = true
			}
		}
		if callID != nil {
			e.Call = &Call{ID: *callID, StartedAt: callStarted, AIOutcome: outcome}
		}
		if emailID != nil {
			e.Email = &Email{Subject: emailSubject(box, company, *emailID, subject), TicketID: ticketID}
		}
		newestFirst = append(newestFirst, e)
	}
	oldestFirst := make([]Entry, 0, len(newestFirst))
	for i := len(newestFirst) - 1; i >= 0; i-- {
		oldestFirst = append(oldestFirst, newestFirst[i])
	}
	return oldestFirst, rows.Err()
}

// emailSubject decrypts a received email's subject ("inbound-email-subject:<company>:<email>").
func emailSubject(box *secure.Box, company tenant.CompanyID, emailID string, encrypted *string) *string {
	if encrypted == nil {
		return nil
	}
	subject, err := box.Decrypt(*encrypted, "inbound-email-subject:"+company.String()+":"+emailID)
	if err != nil {
		return nil
	}
	return &subject
}

func placedOrders(ctx context.Context, pool *database.Pool, company tenant.CompanyID, conversationID string) ([]PlacedOrder, error) {
	const statement = `
		SELECT order_number, status, total_cents, currency FROM orders
		WHERE company_id = $1 AND conversation_id = $2 AND order_number IS NOT NULL
		ORDER BY created_at DESC LIMIT 3`
	rows, err := pool.Query(ctx, statement, company.String(), conversationID)
	if err != nil {
		return nil, err
	}
	list := []PlacedOrder{}
	for rows.Next() {
		var o PlacedOrder
		if err := rows.Scan(&o.Number, &o.Status, &o.TotalCents, &o.Currency); err != nil {
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
