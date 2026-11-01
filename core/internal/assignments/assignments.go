// Package assignments emails a person that a ticket is now theirs (the old
// services/assignment-notifications.ts): the number, subject and category
// only, never customer details or notes. Only while the ticket is still
// open and theirs, and only to someone who can take tickets (confirmed, not
// removed): an unconfirmed account's address may not be theirs.
package assignments

import (
	"context"
	"encoding/json"
	"errors"
	"html"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/email"
	"ansa/core/internal/jobs"
	"ansa/core/internal/logging"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/tenant"
	"ansa/core/internal/tickets"
)

// Notifier sends the emails.
type Notifier struct {
	Pool   *database.Pool
	Email  *email.Sender
	AppURL string
	Log    *logging.Logger
}

// HandleJob runs the "ticket.assigned" job.
func (n *Notifier) HandleJob(ctx context.Context, job *jobs.Job) error {
	var payload tickets.AssignedPayload
	if json.Unmarshal(job.Payload, &payload) != nil || payload.TicketID == "" || payload.AssigneeID == "" {
		return &jobs.Failure{Code: "bad_payload", Permanent: true}
	}
	notice, err := readNotice(ctx, n.Pool, job.CompanyID, payload)
	if err != nil || notice == nil {
		return err
	}
	rendered := notice.render(n.AppURL)
	result := n.Email.Send(ctx, email.Message{
		From: n.Email.FromHeader(notice.CompanyName), To: notice.AssigneeEmail,
		Subject: rendered.subject, HTML: rendered.html, Text: rendered.text,
		IdempotencyKey: "ticket-assigned-" + job.ID,
	})
	if !result.OK {
		n.Log.Warn("assignments: email not sent", logging.Code(result.Error))
	}
	return nil
}

type notice struct {
	AssigneeEmail, AssigneeName, Subject, CompanyName string
	Number                                            int
	Category                                          *string
	Automatic, HandlesCategory                        bool
}

// readNotice reads the email's facts, or nil when the ticket isn't open and
// theirs any more, or they can't take tickets.
func readNotice(ctx context.Context, pool *database.Pool, company tenant.CompanyID, payload tickets.AssignedPayload) (*notice, error) {
	const statement = `
		SELECT users.email, users.name, tickets.subject, companies.name, tickets.ticket_number, tickets.category,
			COALESCE(tickets.assigned_automatically, false),
			EXISTS (
				SELECT 1 FROM user_categories
				JOIN categories ON categories.id = user_categories.category_id AND categories.company_id = user_categories.company_id
				WHERE user_categories.company_id = $1 AND user_categories.user_id = $3
					AND categories.name = tickets.category AND categories.archived_at IS NULL)
		FROM tickets
		JOIN users ON users.id = tickets.assigned_to_user_id AND users.company_id = tickets.company_id
			AND users.email_verified = true AND users.deactivated_at IS NULL
		JOIN companies ON companies.id = tickets.company_id
		WHERE tickets.company_id = $1 AND tickets.id = $2 AND tickets.status = 'open' AND tickets.assigned_to_user_id = $3`
	var n notice
	err := pool.QueryRow(ctx, statement, company.String(), payload.TicketID, payload.AssigneeID).Scan(
		&n.AssigneeEmail, &n.AssigneeName, &n.Subject, &n.CompanyName, &n.Number, &n.Category, &n.Automatic, &n.HandlesCategory)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &n, err
}

type rendered struct{ subject, html, text string }

// render is the email (the old lib/emails/ticket-assigned.ts).
func (n *notice) render(appURL string) rendered {
	number := strconv.Itoa(n.Number)
	cleanSubject := plaintext.SingleLine(n.Subject)
	subject := []rune("Ticket #" + number + " is yours: " + cleanSubject)
	if len(subject) > 150 {
		subject = subject[:150]
	}
	why := n.why()
	link := appURL + "/tickets/" + number
	text := strings.Join([]string{"Hi " + n.AssigneeName + ",", "", "Ticket #" + number + ` "` + cleanSubject + `" is now assigned to you. ` + why, "", "Open it: " + link}, "\n")
	page := `<!doctype html>
<html>
  <body style="font-family: sans-serif; line-height: 1.5; color: #111;">
    <p>Hi ` + html.EscapeString(n.AssigneeName) + `,</p>
    <p>Ticket #` + number + ` <strong>"` + html.EscapeString(cleanSubject) + `"</strong> is now assigned to you. ` + html.EscapeString(why) + `</p>
    <p><a href="` + html.EscapeString(link) + `">Open ticket #` + number + `</a></p>
  </body>
</html>`
	return rendered{subject: string(subject), html: page, text: text}
}

// why claims the category only when they handle it.
func (n *notice) why() string {
	switch {
	case !n.Automatic:
		return "A teammate assigned it to you."
	case n.Category != nil && n.HandlesCategory:
		return "It was routed to you automatically because you handle " + *n.Category + "."
	}
	return "It was routed to you automatically."
}
