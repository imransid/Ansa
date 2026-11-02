package inbound

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/secure"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
	"ansa/core/internal/tickets"
)

// The claims (fixed SQL, never input): a new email (or one whose run was
// cut off 15+ minutes ago); "Process again" (content unavailable, a
// processing error, or stuck); "Make a ticket anyway" (what the filters skipped).
const (
	claimNew    = `status = 'received' OR (status = 'processing' AND processing_started_at < now() - interval '15 minutes')`
	ClaimAgain  = claimNew + ` OR (status = 'ignored' AND ignored_reason IN ('content_unavailable', 'processing_error'))`
	ClaimAnyway = `status = 'ignored' AND ignored_reason IN ('support_address', 'auto_reply', 'bulk', 'bounce', 'rate_limited')`
)

// claimEmail claims the email in ONE UPDATE (two runs never both get it)
// and returns its Resend id ("" = not claimed).
func claimEmail(ctx context.Context, pool *database.Pool, company tenant.CompanyID, inboundEmailID, condition string) (string, error) {
	statement := `
		UPDATE inbound_emails SET status = 'processing', ignored_reason = NULL, processing_started_at = now()
		WHERE company_id = $1 AND id = $2 AND (` + condition + `)
		RETURNING resend_email_id`
	var resendID string
	err := pool.QueryRow(ctx, statement, company.String(), inboundEmailID).Scan(&resendID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return resendID, err
}

// markIgnored records why the email isn't a request, only while this run
// still holds it ("processing").
func markIgnored(ctx context.Context, pool *database.Pool, company tenant.CompanyID, inboundEmailID, reason, from string) error {
	const statement = `
		UPDATE inbound_emails SET status = 'ignored', ignored_reason = $3, from_address = COALESCE(NULLIF($4, ''), from_address)
		WHERE company_id = $1 AND id = $2 AND status = 'processing'`
	_, err := pool.Exec(ctx, statement, company.String(), inboundEmailID, reason, from)
	return err
}

// stillProcessing: the email is "processing" (a run holds it, or held it
// when core stopped).
func stillProcessing(ctx context.Context, pool *database.Pool, company tenant.CompanyID, inboundEmailID string) (bool, error) {
	const statement = `SELECT EXISTS (SELECT 1 FROM inbound_emails WHERE company_id = $1 AND id = $2 AND status = 'processing')`
	var processing bool
	err := pool.QueryRow(ctx, statement, company.String(), inboundEmailID).Scan(&processing)
	return processing, err
}

func supportAddresses(ctx context.Context, pool *database.Pool, company tenant.CompanyID) ([]string, error) {
	return readStrings(ctx, pool, `SELECT lower(address) FROM inbound_addresses WHERE company_id = $1`, company)
}

func activeCategories(ctx context.Context, pool *database.Pool, company tenant.CompanyID) ([]string, error) {
	return readStrings(ctx, pool, `SELECT name FROM categories WHERE company_id = $1 AND archived_at IS NULL ORDER BY name`, company)
}

func readStrings(ctx context.Context, pool *database.Pool, statement string, company tenant.CompanyID) ([]string, error) {
	rows, err := pool.Query(ctx, statement, company.String())
	if err != nil {
		return nil, err
	}
	list := []string{}
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		list = append(list, value)
	}
	return list, rows.Err()
}

// saveRequest saves the request and the encrypted email in ONE transaction,
// only while the email is still "processing" (its row locked first): false
// when another run finished it. The sender joins their conversation.
func saveRequest(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, inboundEmailID string, email Prepared, s Sender, r request) (bool, error) {
	id := company.String()
	subject, err := box.Encrypt(email.Subject, "inbound-email-subject:"+id+":"+inboundEmailID)
	if err != nil {
		return false, err
	}
	var body, names *string
	if email.Body != "" {
		encrypted, err := box.Encrypt(email.Body, "inbound-email-body:"+id+":"+inboundEmailID)
		if err != nil {
			return false, err
		}
		body = &encrypted
	}
	if len(email.AttachmentNames) > 0 {
		list, _ := json.Marshal(email.AttachmentNames)
		encrypted, err := box.Encrypt(string(list), "inbound-email-attachments:"+id+":"+inboundEmailID)
		if err != nil {
			return false, err
		}
		names = &encrypted
	}
	saved := false
	err = database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		var status string
		if err := tx.QueryRow(ctx, `SELECT status FROM inbound_emails WHERE company_id = $1 AND id = $2 FOR UPDATE`, id, inboundEmailID).Scan(&status); err != nil || status != "processing" {
			return ignoreNoRows(err)
		}
		ticketID, err := tickets.CreateEmailTicketWithin(ctx, tx, company, newEmailRequest(s, r))
		if err != nil {
			return err
		}
		const update = `
			UPDATE inbound_emails SET from_address = NULLIF($3, ''), sender_verified = $4, reply_to_address = NULLIF($5, ''), subject_encrypted = $6,
				body_encrypted = $7, body_from_html = $8, attachment_count = $9, attachment_names_encrypted = $10, inline_image_count = $11,
				status = 'ticketed', ticket_id = $12
			WHERE company_id = $1 AND id = $2 AND status = 'processing'`
		if _, err := tx.Exec(ctx, update, id, inboundEmailID, s.Shown, s.Verified, s.ReplyTo, subject, body, email.BodyFromHTML,
			email.AttachmentCount, names, email.InlineImageCount, ticketID); err != nil {
			return err
		}
		saved = true
		if s.Shown == "" {
			return nil
		}
		// Verified senders by their address; others apart ("unverified:"), so
		// a forged From never joins a real customer's conversation.
		external := strings.ToLower(s.Shown)
		if !s.Verified {
			external = "unverified:" + external
		}
		name := firstNonEmpty(s.Name, external)
		contact := conversations.ContactKey{Channel: conversations.ChannelEmail, ExternalID: external, DisplayName: &name}
		return conversations.LinkInboundEmailWithin(ctx, tx, company, contact, inboundEmailID, ticketID)
	})
	return saved, err
}

// newEmailRequest: the customer's email is filled in ONLY for a verified
// sender with no other Reply-To who isn't one of the company's addresses
// (the "solved" email goes there); otherwise a person confirms it.
func newEmailRequest(s Sender, r request) tickets.NewEmailRequest {
	description := strings.TrimSpace(strings.Join([]string{r.Summary, emailRequestNote, missingNote(r.MissingAI)}, "\n\n"))
	for strings.Contains(description, "\n\n\n\n") {
		description = strings.ReplaceAll(description, "\n\n\n\n", "\n\n")
	}
	customerEmail := ""
	if s.Verified && s.ReplyTo == "" && s.Own == "" {
		customerEmail = s.Address
	}
	return tickets.NewEmailRequest{Subject: r.Subject, Description: description, CategoryID: "", CategoryName: r.Category, CustomerName: s.Name, CustomerEmail: customerEmail}
}

func missingNote(why string) string {
	if why == "" {
		return ""
	}
	return "No AI summary or category: " + why + "."
}

func ignoreNoRows(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	return err
}

// Line is one received email on the Emails page: who, when, what became of
// it; never its content.
type Line struct {
	ID            string    `json:"id"`
	ReceivedAt    time.Time `json:"receivedAt"`
	From          *string   `json:"from"`
	Status        string    `json:"status"`
	IgnoredReason *string   `json:"ignoredReason"`
	TicketNumber  *int      `json:"ticketNumber"`
	Stuck         bool      `json:"stuck"`
}

// List is one page (50) of the company's received emails, newest first.
func List(ctx context.Context, pool *database.Pool, company tenant.CompanyID, page int) ([]Line, error) {
	const statement = `
		SELECT inbound_emails.id, inbound_emails.received_at, inbound_emails.from_address, inbound_emails.status, inbound_emails.ignored_reason,
			tickets.ticket_number,
			(inbound_emails.status = 'received' AND inbound_emails.received_at < now() - interval '15 minutes')
				OR (inbound_emails.status = 'processing' AND inbound_emails.processing_started_at < now() - interval '15 minutes')
		FROM inbound_emails
		LEFT JOIN tickets ON tickets.id = inbound_emails.ticket_id AND tickets.company_id = inbound_emails.company_id
		WHERE inbound_emails.company_id = $1
		ORDER BY inbound_emails.received_at DESC, inbound_emails.id DESC LIMIT 50 OFFSET $2`
	rows, err := pool.Query(ctx, statement, company.String(), (min(max(page, 1), 10_000)-1)*50)
	if err != nil {
		return nil, err
	}
	lines := []Line{}
	for rows.Next() {
		var l Line
		if err := rows.Scan(&l.ID, &l.ReceivedAt, &l.From, &l.Status, &l.IgnoredReason, &l.TicketNumber, &l.Stuck); err != nil {
			return nil, err
		}
		lines = append(lines, l)
	}
	return lines, rows.Err()
}

// Count is how many emails the company received (the Emails page's pages).
func Count(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (int, error) {
	var total int
	err := pool.QueryRow(ctx, `SELECT count(*) FROM inbound_emails WHERE company_id = $1`, company.String()).Scan(&total)
	return total, err
}
