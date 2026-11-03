package inbox

import (
	"context"
	"time"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

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

// Email is a received email linked to a conversation, with the request it
// became (its number: the page links the request's own page, where the
// email's content is).
type Email struct {
	Subject      *string `json:"subject"`
	TicketID     *string `json:"ticketId"`
	TicketNumber *int    `json:"ticketNumber"`
}

// entries are the newest 200 entries, oldest first.
func entries(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, conversationID string) ([]Entry, error) {
	const statement = `
		SELECT messages.id, messages.author, author.name, messages.created_at, messages.send_status, messages.send_error, messages.body_encrypted,
			calls.id, calls.started_at, calls.ai_outcome, inbound_emails.id, inbound_emails.subject_encrypted, inbound_emails.ticket_id, tickets.ticket_number
		FROM messages
		LEFT JOIN users AS author ON author.id = messages.author_user_id AND author.company_id = messages.company_id
		LEFT JOIN calls ON calls.id = messages.call_id AND calls.company_id = messages.company_id
		LEFT JOIN inbound_emails ON inbound_emails.id = messages.inbound_email_id AND inbound_emails.company_id = messages.company_id
		LEFT JOIN tickets ON tickets.id = inbound_emails.ticket_id AND tickets.company_id = inbound_emails.company_id
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
		var ticketNumber *int
		if err := rows.Scan(&e.ID, &e.Author, &e.AuthorName, &e.CreatedAt, &e.SendStatus, &e.SendError, &body, &callID, &callStarted, &outcome, &emailID, &subject, &ticketID, &ticketNumber); err != nil {
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
			e.Email = &Email{Subject: emailSubject(box, company, *emailID, subject), TicketID: ticketID, TicketNumber: ticketNumber}
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
