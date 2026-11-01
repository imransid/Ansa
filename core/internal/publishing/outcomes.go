package publishing

import (
	"context"

	"github.com/jackc/pgx/v5/pgconn"

	"ansa/core/internal/database"
	"ansa/core/internal/social"
)

// What became of one claimed job, each outcome in ONE transaction: the
// draft's row locked first, the job changed only while this run still
// holds it ("publishing" under its claim id), the draft's status following
// its jobs, and the outcome in the activity log by the app. False: the run
// lost the job meanwhile (handed to a person as cut off): nothing changed.

// Every write below ends with the same WHERE: this company's job, still
// "publishing" under this run's claim ($1-$3).

func recordPublished(ctx context.Context, pool *database.Pool, claim *Claim, result PostResult) (bool, error) {
	return finish(ctx, pool, claim, Activity{Action: "published"}, func(tx database.Tx) (bool, error) {
		update := `UPDATE publish_jobs SET status = 'published', published_at = now(), external_post_id = $4, external_url = NULLIF($5, ''), last_error = NULL, updated_at = now() WHERE company_id = $1 AND id = $2 AND status = 'publishing' AND claim_id = $3`
		return changedOne(tx.Exec(ctx, update, claim.Company.String(), claim.JobID, claim.ClaimID, result.PostID, result.URL))
	})
}

// recordFailed: nothing went out. storedToken (not ""): the platform
// refused the account's token, so the account needs a reconnect too, while
// it still holds that token.
func recordFailed(ctx context.Context, pool *database.Pool, claim *Claim, code, storedToken string) (bool, error) {
	return finish(ctx, pool, claim, Activity{Action: "publish_failed", Code: code}, func(tx database.Tx) (bool, error) {
		update := `UPDATE publish_jobs SET status = 'failed', last_error = $4, updated_at = now() WHERE company_id = $1 AND id = $2 AND status = 'publishing' AND claim_id = $3`
		failed, err := changedOne(tx.Exec(ctx, update, claim.Company.String(), claim.JobID, claim.ClaimID, code))
		if err != nil || !failed || storedToken == "" {
			return failed, err
		}
		marked, err := social.MarkNeedsReconnectWithin(ctx, tx, claim.Company, claim.ConnectionID, storedToken, "token_rejected")
		if err != nil || !marked {
			return true, err
		}
		return true, recordWithin(ctx, tx, claim.Company, Activity{Action: "reconnect_needed", ConnectionID: claim.ConnectionID, Code: "token_rejected"})
	})
}

// recordNeedsAttention: the platform may have made the post. A person
// checks; it is never sent again by itself.
func recordNeedsAttention(ctx context.Context, pool *database.Pool, claim *Claim, code string) (bool, error) {
	return finish(ctx, pool, claim, Activity{Action: "needs_attention", Code: code}, func(tx database.Tx) (bool, error) {
		update := `UPDATE publish_jobs SET status = 'needs_attention', last_error = $4, updated_at = now() WHERE company_id = $1 AND id = $2 AND status = 'publishing' AND claim_id = $3`
		return changedOne(tx.Exec(ctx, update, claim.Company.String(), claim.JobID, claim.ClaimID, code))
	})
}

// requeue puts the job back, tried again in waitSeconds: nothing went out.
// A platform's "slow down" counts this try; the daily limit and a run too
// slow to send asked nobody, so their try is given back.
func requeue(ctx context.Context, pool *database.Pool, claim *Claim, waitSeconds int, code string, countsAsTry bool) (bool, error) {
	return finish(ctx, pool, claim, Activity{Action: "publish_delayed", Code: code}, func(tx database.Tx) (bool, error) {
		update := `
			UPDATE publish_jobs SET status = 'queued', run_after = now() + make_interval(secs => $4), last_error = $5,
				attempts = CASE WHEN $6 THEN attempts ELSE attempts - 1 END, updated_at = now()
			WHERE company_id = $1 AND id = $2 AND status = 'publishing' AND claim_id = $3`
		return changedOne(tx.Exec(ctx, update, claim.Company.String(), claim.JobID, claim.ClaimID, waitSeconds, code, countsAsTry))
	})
}

// changedOne: the statement changed the job (this run still held it).
func changedOne(tag pgconn.CommandTag, err error) (bool, error) {
	return err == nil && tag.RowsAffected() == 1, err
}

func finish(ctx context.Context, pool *database.Pool, claim *Claim, activity Activity, write func(tx database.Tx) (bool, error)) (bool, error) {
	written := false
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := lockDraftRowWithin(ctx, tx, claim.Company, claim.DraftID); err != nil {
			return err
		}
		var err error
		if written, err = write(tx); err != nil || !written {
			return err
		}
		if err := syncDraftWithin(ctx, tx, claim.Company, claim.DraftID); err != nil {
			return err
		}
		activity.DraftID, activity.JobID, activity.ConnectionID = claim.DraftID, claim.JobID, claim.ConnectionID
		return recordWithin(ctx, tx, claim.Company, activity)
	})
	return written, err
}
