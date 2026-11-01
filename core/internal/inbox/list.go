// Package inbox is the Inbox (the old services/conversations.ts and
// db/conversations.ts): one company's conversations, one conversation's
// page, and a person's work in it (take over, hand back, reply, the
// assistant's waiting replies, important people). Everyone in the company
// works conversations, as they work tickets; every write reads the person
// again. Message texts are decrypted only for the company's own team.
package inbox

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// Views of the Inbox: "needs-you" (an open request, or a reply of the
// assistant waiting for a person) and "all".
const (
	ViewNeedsYou = "needs-you"
	ViewAll      = "all"
)

// One page of a list, and the most pages a link may point to.
const (
	PageSize = 50
	MaxPages = 10_000
)

// needsYou is the "Needs you" condition (Home counts with the same one).
const needsYou = `(
	EXISTS (SELECT 1 FROM tickets WHERE tickets.company_id = conversations.company_id AND tickets.conversation_id = conversations.id AND tickets.status = 'open')
	OR EXISTS (SELECT 1 FROM messages WHERE messages.company_id = conversations.company_id AND messages.conversation_id = conversations.id AND messages.send_status = 'draft'))`

// Row is one conversation in the list.
type Row struct {
	ID             string      `json:"id"`
	Channel        string      `json:"channel"`
	DisplayName    *string     `json:"displayName"`
	ExternalID     string      `json:"externalId"`
	HandledBy      string      `json:"handledBy"`
	LastActivityAt time.Time   `json:"lastActivityAt"`
	Preview        string      `json:"preview"`
	OpenTicket     *TicketLine `json:"openTicket"`
}

// TicketLine names a request.
type TicketLine struct {
	ID      string `json:"id"`
	Number  int    `json:"number"`
	Subject string `json:"subject"`
}

// List is one page of a view, the latest activity first, with each
// conversation's newest entry as a preview and its newest open request.
func List(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, view string, page int) ([]Row, error) {
	where := `conversations.company_id = $1`
	if view == ViewNeedsYou {
		where += ` AND ` + needsYou
	}
	// where is built from the fixed text above, never input.
	statement := `
		SELECT conversations.id, contacts.channel, contacts.display_name, contacts.external_id, conversations.handled_by, conversations.last_activity_at
		FROM conversations
		JOIN contacts ON contacts.id = conversations.contact_id AND contacts.company_id = conversations.company_id
		WHERE ` + where + `
		ORDER BY conversations.last_activity_at DESC, conversations.id DESC
		LIMIT $2 OFFSET $3`
	rows, err := pool.Query(ctx, statement, company.String(), PageSize, (clampPage(page)-1)*PageSize)
	if err != nil {
		return nil, err
	}
	list := []Row{}
	for rows.Next() {
		var r Row
		if err := rows.Scan(&r.ID, &r.Channel, &r.DisplayName, &r.ExternalID, &r.HandledBy, &r.LastActivityAt); err != nil {
			return nil, err
		}
		list = append(list, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for i := range list {
		if list[i].Preview, err = preview(ctx, pool, box, company, list[i].ID); err != nil {
			return nil, err
		}
		if list[i].OpenTicket, err = newestOpenTicket(ctx, pool, company, list[i].ID); err != nil {
			return nil, err
		}
	}
	return list, nil
}

// Counts is how many conversations each view holds.
func Counts(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (map[string]int, error) {
	var needs, all int
	statement := `SELECT count(*) FILTER (WHERE ` + needsYou + `), count(*) FROM conversations WHERE conversations.company_id = $1`
	err := pool.QueryRow(ctx, statement, company.String()).Scan(&needs, &all)
	return map[string]int{ViewNeedsYou: needs, ViewAll: all}, err
}

func clampPage(page int) int {
	return min(max(page, 1), MaxPages)
}

// preview is one line about the newest entry: a message's start ("ansa: ..."
// or "You: ..." for the business's side), or "Phone call" / "Email".
func preview(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, conversationID string) (string, error) {
	const statement = `
		SELECT id, author, body_encrypted, call_id IS NOT NULL, inbound_email_id IS NOT NULL FROM messages
		WHERE company_id = $1 AND conversation_id = $2
		ORDER BY created_at DESC LIMIT 1`
	var id, author string
	var body *string
	var call, email bool
	err := pool.QueryRow(ctx, statement, company.String(), conversationID).Scan(&id, &author, &body, &call, &email)
	switch {
	case err != nil:
		return "", ignoreNoRows(err)
	case call:
		return "Phone call", nil
	case email:
		return "Email", nil
	}
	text := "(could not be decrypted)"
	if body != nil {
		if plain, err := box.Decrypt(*body, conversations.MessageContext(company, id)); err == nil {
			text = cut(plaintext.SingleLine(plain), 120)
		}
	}
	switch author {
	case "customer":
		return text, nil
	case "assistant":
		return "ansa: " + text, nil
	}
	return "You: " + text, nil
}

func newestOpenTicket(ctx context.Context, pool *database.Pool, company tenant.CompanyID, conversationID string) (*TicketLine, error) {
	tickets, err := OpenTickets(ctx, pool, company, conversationID)
	if err != nil || len(tickets) == 0 {
		return nil, err
	}
	return &tickets[0], nil
}

// OpenTickets are a conversation's open requests, newest first.
func OpenTickets(ctx context.Context, pool *database.Pool, company tenant.CompanyID, conversationID string) ([]TicketLine, error) {
	rows, err := pool.Query(ctx, `SELECT id, ticket_number, subject FROM tickets WHERE company_id = $1 AND conversation_id = $2 AND status = 'open' ORDER BY created_at DESC`, company.String(), conversationID)
	if err != nil {
		return nil, err
	}
	list := []TicketLine{}
	for rows.Next() {
		var t TicketLine
		if err := rows.Scan(&t.ID, &t.Number, &t.Subject); err != nil {
			return nil, err
		}
		list = append(list, t)
	}
	return list, rows.Err()
}

func cut(text string, max int) string {
	if utf8.RuneCountInString(text) <= max {
		return text
	}
	return strings.TrimSpace(string([]rune(text)[:max]))
}
