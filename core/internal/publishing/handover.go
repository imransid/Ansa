package publishing

import (
	"context"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// handOverCutOffJobs hands the jobs cut off while sending (still
// "publishing" 10+ minutes after their claim) to a person: "needs
// attention", "interrupted", NEVER queued or sent again by themselves (no
// platform offers a way to post only once). Returns how many.
func handOverCutOffJobs(ctx context.Context, pool *database.Pool, onlyCompany string) (int, error) {
	const find = `
		-- cross-company: jobs cut off while sending, of every company; ids only, each handed over through the company-scoped path below.
		SELECT company_id, id, draft_id, connection_id FROM publish_jobs
		WHERE status = 'publishing' AND claimed_at < now() - make_interval(secs => $1) AND ($2 = '' OR company_id::text = $2)
		ORDER BY claimed_at LIMIT 100`
	rows, err := pool.Query(ctx, find, staleAfter.Seconds(), onlyCompany)
	if err != nil {
		return 0, err
	}
	var stale []Claim
	for rows.Next() {
		var companyText string
		var job Claim
		if err := rows.Scan(&companyText, &job.JobID, &job.DraftID, &job.ConnectionID); err != nil {
			rows.Close()
			return 0, err
		}
		if job.Company, err = tenant.FromTrustedSource(companyText); err != nil {
			rows.Close()
			return 0, err
		}
		stale = append(stale, job)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	handed := 0
	for _, job := range stale {
		done, err := handOverOne(ctx, pool, job)
		if err != nil {
			return handed, err
		}
		if done {
			handed++
		}
	}
	return handed, nil
}

// handOverOne: the draft's row locked first (the lock order everywhere),
// then the job handed over if it is still cut off. False: it finished meanwhile.
func handOverOne(ctx context.Context, pool *database.Pool, job Claim) (bool, error) {
	handed := false
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := lockDraftRowWithin(ctx, tx, job.Company, job.DraftID); err != nil {
			return err
		}
		var err error
		handed, err = handOverCutOffWithin(ctx, tx, job)
		return err
	})
	return handed, err
}

// handOverCutOffWithin, inside a transaction that locked the job's draft:
// the job "needs attention" ("interrupted") if it is still "publishing" 10+
// minutes after its claim, the draft's status following, the app's activity
// row with it. False: it isn't (it finished, or was handed over,
// meanwhile). Besides the runners, a person's Mark or Retry calls it
// first: the pages show such a post as needing attention at once.
func handOverCutOffWithin(ctx context.Context, tx database.Tx, job Claim) (bool, error) {
	const update = `
		UPDATE publish_jobs SET status = 'needs_attention', last_error = 'interrupted', updated_at = now()
		WHERE company_id = $1 AND id = $2 AND status = 'publishing' AND claimed_at < now() - make_interval(secs => $3)`
	tag, err := tx.Exec(ctx, update, job.Company.String(), job.JobID, staleAfter.Seconds())
	if err != nil || tag.RowsAffected() == 0 {
		return false, err
	}
	if err := syncDraftWithin(ctx, tx, job.Company, job.DraftID); err != nil {
		return false, err
	}
	activity := Activity{Action: "needs_attention", DraftID: job.DraftID, JobID: job.JobID, ConnectionID: job.ConnectionID, Code: "interrupted"}
	return true, recordWithin(ctx, tx, job.Company, activity)
}
