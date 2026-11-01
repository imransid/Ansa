package publishing

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// What an owner does to one of the company's posts on the queue or a
// draft's page (the old db/publish-job-actions.ts): cancel a waiting post,
// send one now, and say what became of one that needs attention after
// checking the platform. Each in ONE transaction: the owner's role read
// again (FOR SHARE), then the draft's row, then the job's (the lock order
// everywhere), the draft's status following its jobs, and the change in
// the activity log. Outcomes: "changed", "not-found", "not-allowed",
// "wrong-status". A Retry is retry.go (it is checked like a new schedule).

// CancelJob cancels one of the company's waiting posts: it never goes out.
func CancelJob(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, jobID string) (string, error) {
	const cancel = `UPDATE publish_jobs SET status = 'canceled', canceled_by_user_id = $3, updated_at = now() WHERE company_id = $1 AND id = $2`
	return changeLockedJob(ctx, pool, company, actorUserID, jobID, "queued", "canceled", cancel, actorUserID)
}

// PublishJobNow brings a waiting post's time to now; the caller sends it
// right after the answer (Runner.SendSoon), checked as every run is.
func PublishJobNow(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, jobID string) (string, error) {
	const now = `UPDATE publish_jobs SET scheduled_for = now(), run_after = now(), updated_at = now() WHERE company_id = $1 AND id = $2`
	return changeLockedJob(ctx, pool, company, actorUserID, jobID, "queued", "publish_now", now)
}

// MarkJobPublished: an owner checked the platform and the post that needed
// attention is there, at postURL if they gave its address ("" = none;
// already checked against the platform's hosts: ReadPostURL). The reason it
// needed attention stays on the job.
func MarkJobPublished(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, jobID, postURL string) (string, error) {
	const mark = `UPDATE publish_jobs SET status = 'published', published_at = now(), external_url = NULLIF($3, ''), updated_at = now() WHERE company_id = $1 AND id = $2`
	return changeLockedJob(ctx, pool, company, actorUserID, jobID, "needs_attention", "marked_published", mark, postURL)
}

// MarkJobNotPublished: an owner checked and the post isn't there, so it
// failed (with the reason it needed attention); a Retry may send it again.
func MarkJobNotPublished(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, jobID string) (string, error) {
	const mark = `UPDATE publish_jobs SET status = 'failed', updated_at = now() WHERE company_id = $1 AND id = $2`
	return changeLockedJob(ctx, pool, company, actorUserID, jobID, "needs_attention", "marked_not_published", mark)
}

// changeLockedJob is the steps every action above shares: the owner, the
// job's draft locked, the job locked (one cut off while sending handed to
// a person first) and in the status the action starts from, the change
// (its $1 the company, $2 the job, then extra), the draft's status, the
// activity row.
func changeLockedJob(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, jobID, from, action, change string, extra ...any) (string, error) {
	outcome := "changed"
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role != "owner" {
			outcome = "not-allowed"
			return err
		}
		job, err := lockJobAndItsDraftWithin(ctx, tx, company, jobID)
		if errors.Is(err, pgx.ErrNoRows) {
			outcome = "not-found"
			return nil
		}
		if err != nil {
			return err
		}
		status, err := statusAfterHandOverWithin(ctx, tx, company, job)
		if err != nil || status != from {
			outcome = "wrong-status"
			return err
		}
		if _, err := tx.Exec(ctx, change, append([]any{company.String(), jobID}, extra...)...); err != nil {
			return err
		}
		if err := syncDraftWithin(ctx, tx, company, job.DraftID); err != nil {
			return err
		}
		return recordWithin(ctx, tx, company, Activity{Action: action, ActorUserID: actorUserID, DraftID: job.DraftID, JobID: jobID, ConnectionID: job.ConnectionID})
	})
	return outcome, err
}

// lockedJob is a job as an owner's action reads it, its row locked.
type lockedJob struct {
	JobID, DraftID, ConnectionID, Status, ApprovalMode string
}

// lockJobAndItsDraftWithin locks the job's draft, then the job (a job's
// draft never changes, so it can be read first): the order every change of
// drafts and jobs takes. pgx.ErrNoRows: no such job in this company.
func lockJobAndItsDraftWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, jobID string) (lockedJob, error) {
	var draftID string
	err := tx.QueryRow(ctx, `SELECT draft_id FROM publish_jobs WHERE company_id = $1 AND id::text = $2`, company.String(), jobID).Scan(&draftID)
	if err != nil {
		return lockedJob{}, err
	}
	if err := lockDraftRowWithin(ctx, tx, company, draftID); err != nil {
		return lockedJob{}, err
	}
	job := lockedJob{JobID: jobID}
	const lock = `SELECT draft_id, connection_id, status, approval_mode FROM publish_jobs WHERE company_id = $1 AND id::text = $2 FOR UPDATE`
	err = tx.QueryRow(ctx, lock, company.String(), jobID).Scan(&job.DraftID, &job.ConnectionID, &job.Status, &job.ApprovalMode)
	return job, err
}

// statusAfterHandOverWithin is the job's status once a post cut off while
// sending is handed to a person in this transaction: the pages show it as
// needing attention already, and the next runner may not have come yet.
func statusAfterHandOverWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, job lockedJob) (string, error) {
	if job.Status != "publishing" {
		return job.Status, nil
	}
	handed, err := handOverCutOffWithin(ctx, tx, Claim{Company: company, JobID: job.JobID, DraftID: job.DraftID, ConnectionID: job.ConnectionID})
	if err != nil || !handed {
		return job.Status, err
	}
	return "needs_attention", nil
}
