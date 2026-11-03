package comments

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/jobs"
	"ansa/core/internal/messenger"
	"ansa/core/internal/packages"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// Saver saves the comments the Page webhook hands over
// (messenger.CommentSaver).
type Saver struct {
	Pool *database.Pool
	Box  *secure.Box
}

// SaveComment saves one new comment for the company that has its Page
// connected (the webhook found it from the Page id Meta signed).
func (s *Saver) SaveComment(ctx context.Context, company tenant.CompanyID, connectionID string, event messenger.CommentEvent) error {
	_, err := Save(ctx, s.Pool, s.Box, company, connectionID, event, time.Now())
	return err
}

// Save saves a new comment once (one row per Meta comment id: an ad or a
// boosted post can send it twice), its text encrypted, and in the same
// transaction queues ansa's answer, or saves it skipped with why. It
// returns the row's id, or "" when ansa keeps nothing of it: the Page's own
// reply inside a thread (ansa's own replies come back that way), or a
// comment saved before.
func Save(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, connectionID string, event messenger.CommentEvent, now time.Time) (string, error) {
	if event.FromID == event.PageID && !event.OnThePost() {
		return "", nil
	}
	id, err := conversations.NewID()
	if err != nil {
		return "", err
	}
	text, err := box.Encrypt(event.Describe(), TextContext(company, id, "text"))
	if err != nil {
		return "", err
	}
	saved := ""
	err = database.InTx(ctx, pool, func(tx database.Tx) error {
		reason, err := skipReasonWithin(ctx, tx, company, connectionID, event, now)
		if err != nil {
			return err
		}
		inserted, err := insertComment(ctx, tx, company, connectionID, id, text, event, reason)
		if err != nil || !inserted {
			return err
		}
		saved = id
		if reason != "" {
			return nil
		}
		return queueAnswerWithin(ctx, tx, company, id)
	})
	return saved, err
}

// skipReasonWithin is why ansa doesn't answer this comment ("" = it does):
// the Page's own comment (ansa never answers itself), a reply inside a
// thread (only comments on the post are answered), one past Meta's 7 days
// for a private reply, comments switched off, the Page not allowed, or a
// package without comments.
func skipReasonWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, connectionID string, event messenger.CommentEvent, now time.Time) (string, error) {
	switch {
	case event.FromID == event.PageID:
		return SkipOwnComment, nil
	case !event.OnThePost():
		return SkipReplyInThread, nil
	case now.Sub(event.CreatedAt) > privateReplyWindow:
		return SkipTooOld, nil
	}
	found, err := readSwitches(ctx, tx, company, connectionID)
	if err != nil {
		return "", err
	}
	pkg, err := packages.Of(ctx, tx, company, now)
	if err != nil {
		return "", err
	}
	return found.skipNowReason(pkg.AnswersComments()), nil
}

func insertComment(ctx context.Context, tx database.Tx, company tenant.CompanyID, connectionID, id, text string, event messenger.CommentEvent, reason string) (bool, error) {
	const statement = `
		INSERT INTO page_comments (id, company_id, connection_id, page_id, post_id, comment_id, parent_id, commenter_id, commenter_name,
			text_encrypted, commented_at, status, skip_reason)
		VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), $8, NULLIF($9, ''), $10, $11, $12, NULLIF($13, ''))
		ON CONFLICT (company_id, comment_id) DO NOTHING
		RETURNING id`
	status := StatusNew
	if reason != "" {
		status = StatusSkipped
	}
	var inserted string
	err := tx.QueryRow(ctx, statement, id, company.String(), connectionID, event.PageID, event.PostID, event.CommentID, event.ParentID,
		event.FromID, commenterName(event.FromName), text, event.CreatedAt, status, reason).Scan(&inserted)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// commenterName is the name as Meta gives it, as one plain line of at most
// 200 characters ("" for none).
func commenterName(name string) string {
	line := []rune(strings.TrimSpace(plaintext.SingleLine(name)))
	if len(line) > 200 {
		line = line[:200]
	}
	return strings.TrimSpace(string(line))
}

// queueAnswerWithin queues the answering job for one comment, once.
func queueAnswerWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, commentRowID string) error {
	job := jobs.NewJob{Kind: AnswerJobKind, Payload: payload{CommentID: commentRowID}, MaxAttempts: 3, DedupeKey: "comment:" + commentRowID}
	_, err := jobs.EnqueueWithin(ctx, tx, company, job)
	if errors.Is(err, jobs.ErrDuplicate) {
		return nil
	}
	return err
}
