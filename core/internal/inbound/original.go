package inbound

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// Original is the customer's email behind a request, decrypted for the
// person reading the request (the old getOriginalEmailForSession).
type Original struct {
	FromAddress *string `json:"fromAddress"`
	// False: neither DKIM nor DMARC passed, so anyone could have written that From.
	SenderVerified bool `json:"senderVerified"`
	// A Reply-To that differs from From (contact forms put the customer there).
	ReplyToAddress *string `json:"replyToAddress"`
	Subject        *string `json:"subject"`
	Body           *string `json:"body"`
	// No plain-text part: the body is text made from the HTML part.
	BodyFromHTML     bool     `json:"bodyFromHtml"`
	AttachmentCount  int      `json:"attachmentCount"`
	AttachmentNames  []string `json:"attachmentNames"`
	InlineImageCount int      `json:"inlineImageCount"`
	// Stored but can't be decrypted: the page says so, never an empty email.
	Unreadable bool      `json:"unreadable"`
	ReceivedAt time.Time `json:"receivedAt"`
}

// ReadOriginal reads the email a request came from (nil: none).
func ReadOriginal(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, ticketID string) (*Original, error) {
	const statement = `
		SELECT id, from_address, sender_verified, reply_to_address, subject_encrypted, body_encrypted, body_from_html,
			attachment_count, attachment_names_encrypted, inline_image_count, received_at
		FROM inbound_emails WHERE company_id = $1 AND ticket_id = $2
		ORDER BY received_at LIMIT 1`
	var o Original
	var id string
	var subject, body, names *string
	err := pool.QueryRow(ctx, statement, company.String(), ticketID).Scan(&id, &o.FromAddress, &o.SenderVerified, &o.ReplyToAddress,
		&subject, &body, &o.BodyFromHTML, &o.AttachmentCount, &names, &o.InlineImageCount, &o.ReceivedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var subjectBad, bodyBad, namesBad bool
	o.Subject, subjectBad = decrypted(box, subject, "inbound-email-subject:"+company.String()+":"+id)
	o.Body, bodyBad = decrypted(box, body, "inbound-email-body:"+company.String()+":"+id)
	nameList, namesBad := decrypted(box, names, "inbound-email-attachments:"+company.String()+":"+id)
	o.Unreadable = subjectBad || bodyBad || namesBad
	o.AttachmentNames = []string{}
	if nameList != nil {
		// The stored JSON list of names; anything else reads as none.
		var parsed []string
		if json.Unmarshal([]byte(*nameList), &parsed) == nil {
			o.AttachmentNames = parsed
		}
	}
	return &o, nil
}

func decrypted(box *secure.Box, stored *string, context string) (*string, bool) {
	if stored == nil {
		return nil, false
	}
	text, err := box.Decrypt(*stored, context)
	if err != nil {
		return nil, true
	}
	return &text, false
}
