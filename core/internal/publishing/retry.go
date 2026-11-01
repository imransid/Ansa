package publishing

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"ansa/core/internal/database"
	"ansa/core/internal/drafts"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// RetryJob puts one of the company's posts that failed or needs attention
// back in the queue (one cut off while sending is handed to a person
// first), due now, checked like a new schedule: the draft as it is now
// (an approval of its version, or the rule covering it), the account
// connected, the facts now. It then publishes the draft's CURRENT version,
// its tries counted from 1 again. Owners only. Outcomes: "retried",
// "not-found", "not-allowed", "not-retryable", "already-scheduled" or one
// of DecideSchedule's refusals. The caller sends it right after the answer.
func RetryJob(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, jobID string) (string, error) {
	var outcome string
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		var err error
		outcome, err = retryWithin(ctx, tx, company, actorUserID, jobID)
		return err
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		// The partial unique index: the draft is on its way, out or waiting
		// for a check on that account again (scheduled there since).
		return "already-scheduled", nil
	}
	return outcome, err
}

func retryWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, actorUserID, jobID string) (string, error) {
	role, err := team.RoleWithin(ctx, tx, company, actorUserID)
	if err != nil || role != "owner" {
		return "not-allowed", err
	}
	job, err := lockJobAndItsDraftWithin(ctx, tx, company, jobID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "not-found", nil
	}
	if err != nil {
		return "", err
	}
	draft, err := drafts.LockWithin(ctx, tx, company, job.DraftID)
	if err != nil {
		return "", err
	}
	status, err := statusAfterHandOverWithin(ctx, tx, company, job)
	if err != nil {
		return "", err
	}
	if status != "failed" && status != "needs_attention" {
		return "not-retryable", nil
	}
	request := ScheduleRequest{DraftID: draft.ID, ShownVersion: draft.Version, ConnectionIDs: []string{job.ConnectionID}, WithoutApproval: job.ApprovalMode == "auto_rule"}
	in, ruleID, err := readScheduleInputWithin(ctx, tx, company, draft, request, job.JobID)
	if err != nil {
		return "", err
	}
	mode, refusal := DecideSchedule(in)
	if refusal != "" {
		return refusal, nil
	}
	if mode != "auto_rule" {
		ruleID = ""
	}
	// Every column a new try starts from, named.
	const requeue = `
		UPDATE publish_jobs SET status = 'queued', approval_mode = $3, approved_version = $4, autopublish_rule_id = NULLIF($5, '')::uuid,
			attempts = 0, scheduled_for = now(), run_after = now(), last_error = NULL, external_post_id = NULL, external_url = NULL,
			published_at = NULL, updated_at = now()
		WHERE company_id = $1 AND id = $2 AND status IN ('failed', 'needs_attention')`
	if _, err := tx.Exec(ctx, requeue, company.String(), job.JobID, mode, draft.Version, ruleID); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `UPDATE content_drafts SET status = 'scheduled' WHERE company_id = $1 AND id = $2`, company.String(), draft.ID); err != nil {
		return "", err
	}
	entry := Activity{Action: "retried", ActorUserID: actorUserID, DraftID: draft.ID, JobID: job.JobID, ConnectionID: job.ConnectionID}
	return "retried", recordWithin(ctx, tx, company, entry)
}
