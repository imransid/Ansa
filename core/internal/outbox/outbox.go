// Package outbox delivers the emails ansa sends customers (the old
// services/customer-emails.ts, db/outgoing-email-delivery.ts): each is first
// a row in outgoing_emails, written in the same transaction as the change
// that causes it (a solve), then delivered. A delivery CLAIMS the row in ONE
// UPDATE (pending, failed, or "sending" for 10+ minutes -> sending), so two
// deliveries never both send; "failed" is only recorded over "sending", so
// a late failure never undoes "sent". The row id is Resend's idempotency
// key: a retry within 24 hours of the first try never sends twice; from 23
// hours on, a Retry needs the person's "send it again anyway?".
package outbox

import (
	"context"
	"errors"
	"html"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/email"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/tenant"
)

// What a delivery ended in.
const (
	Sent              = "sent"
	Failed            = "failed"
	NotDeliverable    = "not-deliverable"
	OverDailyLimit    = "over-daily-limit"
	NeedsConfirmation = "needs-confirmation"
)

// HeldBackByDailyLimit is last_error when the company's daily limit held an email back.
const HeldBackByDailyLimit = "daily_limit"

// 300 customer emails a day per company (the old counter; every attempt counts).
var dailyLimit = ratelimit.Rule{MaxAttempts: 300, Window: 24 * time.Hour}

// Deliverer delivers customer emails.
type Deliverer struct {
	Pool    *database.Pool
	Limiter *ratelimit.Limiter
	Email   *email.Sender
	// The forwarding addresses' domain: the Reply-To when a company has none of its own.
	ForwardingDomain string
}

// canStart: never tried, failed, or "sending" so long it was interrupted;
// and only for its request's CURRENT solve, which was meant to email (the
// row and solved_at were written together, so they share now()).
const canStart = `(outgoing_emails.status IN ('pending', 'failed')
		OR (outgoing_emails.status = 'sending' AND outgoing_emails.last_attempt_at < now() - interval '10 minutes'))
	AND EXISTS (SELECT 1 FROM tickets WHERE tickets.company_id = outgoing_emails.company_id AND tickets.id = outgoing_emails.ticket_id
		AND tickets.status = 'solved' AND tickets.solved_without_email = false AND outgoing_emails.created_at >= tickets.solved_at)`

type toDeliver struct {
	to, companyName, inboundToken string
	replyTo                       *string
	number                        int
	mayHaveArrived                bool
}

// Deliver delivers one queued email and records the outcome.
func (d *Deliverer) Deliver(ctx context.Context, company tenant.CompanyID, emailID string, confirmedDuplicate bool) (string, error) {
	statement := `
		SELECT outgoing_emails.to_email, tickets.ticket_number, companies.name, companies.reply_to_email, companies.inbound_token,
			NOT (outgoing_emails.first_attempt_at IS NULL OR outgoing_emails.first_attempt_at > now() - interval '23 hours')
		FROM outgoing_emails
		JOIN tickets ON tickets.id = outgoing_emails.ticket_id AND tickets.company_id = outgoing_emails.company_id
		JOIN companies ON companies.id = outgoing_emails.company_id
		WHERE outgoing_emails.company_id = $1 AND outgoing_emails.id = $2 AND ` + canStart
	var e toDeliver
	err := d.Pool.QueryRow(ctx, statement, company.String(), emailID).Scan(&e.to, &e.number, &e.companyName, &e.replyTo, &e.inboundToken, &e.mayHaveArrived)
	if errors.Is(err, pgx.ErrNoRows) {
		return NotDeliverable, nil
	}
	if err != nil {
		return "", err
	}
	if e.mayHaveArrived && !confirmedDuplicate {
		return NeedsConfirmation, nil
	}
	if over, err := d.Limiter.Over(ctx, "customer-emails", company.String(), dailyLimit); err != nil || over {
		if over {
			_, err = d.Pool.Exec(ctx, `UPDATE outgoing_emails SET last_error = $3 WHERE company_id = $1 AND id = $2 AND `+canStart, company.String(), emailID, HeldBackByDailyLimit)
			return OverDailyLimit, err
		}
		return "", err
	}
	claimed, err := d.claim(ctx, company, emailID, confirmedDuplicate)
	if err != nil || !claimed {
		// Another delivery got it first: this one sends nothing, so it doesn't count.
		_ = d.Limiter.TakeBack(ctx, "customer-emails", company.String())
		return NotDeliverable, err
	}
	result := d.Email.Send(ctx, d.solvedEmail(e, emailID))
	if !result.OK {
		_, err = d.Pool.Exec(ctx, `UPDATE outgoing_emails SET status = 'failed', last_error = left($3, 100) WHERE company_id = $1 AND id = $2 AND status = 'sending'`,
			company.String(), emailID, result.Error)
		return Failed, err
	}
	// Also over "failed": a delivery that outlived its claim still reached the customer.
	_, err = d.Pool.Exec(ctx, `UPDATE outgoing_emails SET status = 'sent', sent_at = now(), provider_message_id = $3, last_error = NULL
		WHERE company_id = $1 AND id = $2 AND status IN ('sending', 'failed')`, company.String(), emailID, result.ProviderID)
	return Sent, err
}

func (d *Deliverer) claim(ctx context.Context, company tenant.CompanyID, emailID string, confirmedDuplicate bool) (bool, error) {
	statement := `
		UPDATE outgoing_emails SET status = 'sending', attempt_count = attempt_count + 1,
			first_attempt_at = COALESCE(first_attempt_at, now()), last_attempt_at = now()
		WHERE company_id = $1 AND id = $2 AND ` + canStart + `
			AND ($3 OR first_attempt_at IS NULL OR first_attempt_at > now() - interval '23 hours')`
	tag, err := d.Pool.Exec(ctx, statement, company.String(), emailID, confirmedDuplicate)
	return tag.RowsAffected() == 1, err
}

// solvedEmail is the fixed "solved" email (the old lib/emails/ticket-solved.ts):
// the request number and the company's name only, never the customer's name
// or the subject (a sender can write both). Replies come back to the company:
// its reply-to address, else its forwarding address.
func (d *Deliverer) solvedEmail(e toDeliver, emailID string) email.Message {
	company := plaintext.SingleLine(e.companyName)
	number := strconv.Itoa(e.number)
	replyTo := "c-" + e.inboundToken + "@" + d.ForwardingDomain
	if e.replyTo != nil && *e.replyTo != "" {
		replyTo = *e.replyTo
	}
	text := strings.Join([]string{"Hello,", "", "Good news: your request #" + number + " has been solved by the " + company + " team.", "",
		"If you still need help, just get in touch with us again.", "", company + " Support"}, "\n")
	page := `<!doctype html>
<html>
  <body style="font-family: sans-serif; line-height: 1.5; color: #111;">
    <p>Hello,</p>
    <p>Good news: your request #` + number + ` has been solved by the ` + html.EscapeString(company) + ` team.</p>
    <p>If you still need help, just get in touch with us again.</p>
    <p>` + html.EscapeString(company) + ` Support</p>
  </body>
</html>`
	return email.Message{From: d.Email.FromHeader(e.companyName), To: e.to, ReplyTo: replyTo, Subject: "Your request #" + number + " has been solved",
		HTML: page, Text: text, IdempotencyKey: "ticket-solved-" + emailID}
}
