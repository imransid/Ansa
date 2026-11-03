package comments

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/assistant"
	"ansa/core/internal/database"
	"ansa/core/internal/jobs"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
	"ansa/core/internal/tickets"
)

// The owners' alert starts after the comment's answer had its time to go
// out, so it can say whether the commenter got the holding reply.
const alertDelay = 20 * time.Second

// save writes the plan in ONE transaction, only while the comment is still
// undecided (a retried run never decides twice): what goes out, encrypted,
// and for a person's request the request itself (numbered and routed under
// the company row lock, taken FIRST as every routing does) and the owners'
// alert.
func (a *Answerer) save(ctx context.Context, company tenant.CompanyID, c *comment, p plan) error {
	if p.SkipReason != "" {
		return markSkipped(ctx, a.Pool, company, c.ID, p.Kind, p.SkipReason)
	}
	public, err := a.encryptPart(company, c.ID, "public_reply", p.Public)
	if err != nil {
		return err
	}
	private, err := a.encryptPart(company, c.ID, "private_message", p.Private)
	if err != nil {
		return err
	}
	return database.InTx(ctx, a.Pool, func(tx database.Tx) error {
		if p.Handover != nil {
			if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
				return err
			}
		}
		const statement = `
			UPDATE page_comments SET decided_at = now(), kind = $3, status = $4,
				public_reply_encrypted = NULLIF($5, ''), public_reply_status = NULLIF($6, ''),
				private_message_encrypted = NULLIF($7, ''), private_message_status = NULLIF($8, '')
			WHERE company_id = $1 AND id = $2 AND status = 'new' AND decided_at IS NULL`
		tag, err := tx.Exec(ctx, statement, company.String(), c.ID, p.Kind, p.status(), public, partStatus(public, p.PublicStatus),
			private, partStatus(private, p.PrivateStatus))
		if err != nil || tag.RowsAffected() != 1 || p.Handover == nil {
			return err
		}
		return a.openRequestWithin(ctx, tx, company, c, *p.Handover)
	})
}

// encryptPart is a part's text encrypted for this comment and field ("" for none).
func (a *Answerer) encryptPart(company tenant.CompanyID, commentRowID, field, text string) (string, error) {
	if text == "" {
		return "", nil
	}
	return a.Box.Encrypt(text, TextContext(company, commentRowID, field))
}

// partStatus is a part's status, only with its text.
func partStatus(encrypted, status string) string {
	if encrypted == "" {
		return ""
	}
	return status
}

// openRequestWithin opens the request a person follows up (routed like
// every new request), ties it to the comment and queues the owners' alert.
// Its conversation comes once the private reply opened the Messenger chat.
func (a *Answerer) openRequestWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, c *comment, h handover) error {
	categoryID, err := activeCategoryID(ctx, tx, company, h.Category)
	if err != nil {
		return err
	}
	request := tickets.NewChatTicket{Subject: requestSubject(h), Description: requestDescription(h), CategoryID: categoryID, CustomerName: c.CommenterName}
	created, err := tickets.CreateChatTicketWithin(ctx, tx, company, request)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE page_comments SET ticket_id = $3 WHERE company_id = $1 AND id = $2`, company.String(), c.ID, created.ID); err != nil {
		return err
	}
	alert := jobs.NewJob{Kind: AlertJobKind, Payload: AlertPayload{CommentID: c.ID, Reason: h.Reason}, RunAfter: time.Now().Add(alertDelay), MaxAttempts: 3}
	_, err = jobs.EnqueueWithin(ctx, tx, company, alert)
	return err
}

// Subjects of a request about an AI text ansa's checks stopped (the AI
// wrote none: its text never went).
var stoppedSubjects = map[string]string{
	assistant.ReasonPriceNotOnMenu: "Comment reply stopped: a price not on your menu",
	assistant.ReasonRefundPromise:  "Comment reply stopped: it promised a refund",
	assistant.ReasonUnknownLink:    "Comment reply stopped: an unknown link",
}

// requestSubject: the AI's own subject when it wrote one (one plain line
// of 1-200), else why ansa stopped, else fixed words.
func requestSubject(h handover) string {
	if subject := plaintext.SingleLine(h.Subject); subject != "" && utf8.RuneCountInString(subject) <= 200 {
		return subject
	}
	if subject, ok := stoppedSubjects[h.Reason]; ok {
		return subject
	}
	return "Facebook comment needs you"
}

// requestDescription: where it came from and why, in plain words, then the
// AI's short summary (never the comment itself: that stays encrypted).
func requestDescription(h handover) string {
	description := "From a comment on your Facebook post. " + assistant.ReasonTextFor(h.Reason, "business")
	if summary := strings.TrimSpace(h.Summary); summary != "" {
		description += "\n\n" + cutRunes(summary, 1_000)
	}
	return description
}

// activeCategoryID is the company's active category with exactly this name, or "".
func activeCategoryID(ctx context.Context, tx database.Tx, company tenant.CompanyID, name string) (string, error) {
	if name == "" {
		return "", nil
	}
	var id string
	err := tx.QueryRow(ctx, `SELECT id::text FROM categories WHERE company_id = $1 AND name = $2 AND archived_at IS NULL`, company.String(), name).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// markSkipped decides nothing goes out, and why (only while undecided).
func markSkipped(ctx context.Context, pool *database.Pool, company tenant.CompanyID, commentRowID, kind, reason string) error {
	const statement = `
		UPDATE page_comments SET decided_at = now(), status = 'skipped', skip_reason = $3, kind = NULLIF($4, '')
		WHERE company_id = $1 AND id = $2 AND status = 'new' AND decided_at IS NULL`
	_, err := pool.Exec(ctx, statement, company.String(), commentRowID, reason, kind)
	return err
}

// markFailed: ansa couldn't answer it (its stored text can't be read).
func markFailed(ctx context.Context, pool *database.Pool, company tenant.CompanyID, commentRowID string) error {
	const statement = `
		UPDATE page_comments SET decided_at = now(), status = 'failed'
		WHERE company_id = $1 AND id = $2 AND status = 'new' AND decided_at IS NULL`
	_, err := pool.Exec(ctx, statement, company.String(), commentRowID)
	return err
}
