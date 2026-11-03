package comments

import (
	"context"

	"ansa/core/internal/database"
	"ansa/core/internal/jobs"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// What a person's Send or Discard ended in.
const (
	OutcomeSent       = "sent"
	OutcomeDiscarded  = "discarded"
	OutcomeChanged    = "changed"
	OutcomeNotAllowed = "not-allowed"
)

// SendWaiting sends ansa's waiting answer to a comment as the AI wrote it
// ("Ask me first"): anyone in the company, the person read again in the
// same transaction, only while it still waits. Its parts become "sending"
// and the answering job sends them right after (the job's own delivery:
// once, never twice).
func SendWaiting(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, commentRowID string) (string, error) {
	const statement = `
		UPDATE page_comments SET status = 'new',
			public_reply_status = CASE WHEN public_reply_status = 'waiting' THEN 'sending' ELSE public_reply_status END,
			private_message_status = CASE WHEN private_message_status = 'waiting' THEN 'sending' ELSE private_message_status END,
			handled_by_user_id = $3, handled_at = now()
		WHERE company_id = $1 AND id = $2 AND status = 'waiting'`
	outcome := OutcomeSent
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if allowed, err := inTheCompanyWithin(ctx, tx, company, actorUserID); err != nil || !allowed {
			outcome = OutcomeNotAllowed
			return err
		}
		tag, err := tx.Exec(ctx, statement, company.String(), commentRowID, actorUserID)
		if err != nil || tag.RowsAffected() != 1 {
			outcome = OutcomeChanged
			return err
		}
		// No dedupe key: the job sends only what is "sending", once.
		_, err = jobs.EnqueueWithin(ctx, tx, company, jobs.NewJob{Kind: AnswerJobKind, Payload: payload{CommentID: commentRowID}, MaxAttempts: 3})
		return err
	})
	return outcome, err
}

// DiscardWaiting drops ansa's waiting answer to a comment: nothing goes
// out, the comment is skipped ("discarded"), with who pressed it.
func DiscardWaiting(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, commentRowID string) (string, error) {
	const statement = `
		UPDATE page_comments SET status = 'skipped', skip_reason = 'discarded',
			public_reply_status = CASE WHEN public_reply_status = 'waiting' THEN 'discarded' ELSE public_reply_status END,
			private_message_status = CASE WHEN private_message_status = 'waiting' THEN 'discarded' ELSE private_message_status END,
			handled_by_user_id = $3, handled_at = now()
		WHERE company_id = $1 AND id = $2 AND status = 'waiting'`
	outcome := OutcomeDiscarded
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if allowed, err := inTheCompanyWithin(ctx, tx, company, actorUserID); err != nil || !allowed {
			outcome = OutcomeNotAllowed
			return err
		}
		tag, err := tx.Exec(ctx, statement, company.String(), commentRowID, actorUserID)
		if err == nil && tag.RowsAffected() != 1 {
			outcome = OutcomeChanged
		}
		return err
	})
	return outcome, err
}

// inTheCompanyWithin: the person is still a confirmed, active member of
// the company (read again, their row locked FOR SHARE).
func inTheCompanyWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, userID string) (bool, error) {
	role, err := team.RoleWithin(ctx, tx, company, userID)
	return role != "", err
}
