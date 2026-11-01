package publishing

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// A job still "publishing" this long after its claim was cut off while
// sending: it may have gone out, so a person checks ("needs attention").
const staleAfter = 10 * time.Minute

// The platform is asked only within this long of the claim, so even its
// longest answer comes before the claim counts as cut off (a person may
// then send it again). A run gets there in seconds; only a stalled
// database makes it later, and then nothing is sent.
const latestSendStart = staleAfter - 3*time.Minute

// Claim is what a run holds once it claimed a job. Every later read and
// write of that run names its ClaimID: the job is only touched while it is
// still "publishing" under it, so a late writer never undoes what another
// decided.
type Claim struct {
	Company                               tenant.CompanyID
	JobID, DraftID, ConnectionID, ClaimID string
	// Its try, counted for a platform's "slow down" (at most maxAttempts).
	Attempt int
}

// Tries before a platform's "slow down" fails a post.
const maxAttempts = 5

// claimNext claims the next due job core can publish (today: Facebook text
// posts) in ONE UPDATE, the longest waiting first, skipping the companies
// in skip (onlyCompany: the tests keep to theirs). WHY "id = (subquery)":
// Postgres may run an IN subquery again for each row it looks at, and with
// SKIP LOCKED one UPDATE could then claim several. nil: none is due.
func claimNext(ctx context.Context, pool *database.Pool, skip []string, onlyCompany string) (*Claim, error) {
	const statement = `
		-- cross-company: the publishing queue serves every company; the claimed row's own company is used after.
		UPDATE publish_jobs SET status = 'publishing', claimed_at = now(), claim_id = gen_random_uuid(), attempts = attempts + 1, updated_at = now()
		WHERE id = (
			SELECT jobs.id FROM publish_jobs AS jobs
			JOIN content_drafts AS drafts ON drafts.company_id = jobs.company_id AND drafts.id = jobs.draft_id
			WHERE jobs.status = 'queued' AND jobs.run_after <= now()
				AND drafts.platform = 'facebook' AND drafts.format = 'post'
				AND NOT (jobs.company_id::text = ANY($1::text[])) AND ($2 = '' OR jobs.company_id::text = $2)
			ORDER BY jobs.run_after, jobs.id
			FOR UPDATE OF jobs SKIP LOCKED
			LIMIT 1
		) AND status = 'queued'
		RETURNING company_id, id, draft_id, connection_id, claim_id, attempts`
	if skip == nil {
		skip = []string{}
	}
	var companyText string
	var claim Claim
	err := pool.QueryRow(ctx, statement, skip, onlyCompany).Scan(&companyText, &claim.JobID, &claim.DraftID, &claim.ConnectionID, &claim.ClaimID, &claim.Attempt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	claim.Company, err = tenant.FromTrustedSource(companyText)
	return &claim, err
}

// stillHeld says, right before the platform is asked, whether this run
// still holds the job ("lost": it ended, or a later run has it) and whether
// its claim is young enough ("too_late": nothing may be sent now). Our own
// database's clock, as for claimed_at.
func stillHeld(ctx context.Context, pool *database.Pool, claim *Claim) (string, error) {
	const statement = `
		SELECT claimed_at > now() - make_interval(secs => $4) FROM publish_jobs
		WHERE company_id = $1 AND id = $2 AND status = 'publishing' AND claim_id = $3`
	var young bool
	err := pool.QueryRow(ctx, statement, claim.Company.String(), claim.JobID, claim.ClaimID, latestSendStart.Seconds()).Scan(&young)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return "lost", nil
	case err != nil:
		return "", err
	case !young:
		return "too_late", nil
	}
	return "held", nil
}

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
// then the job if it is still cut off, the draft's status following, the
// app's activity row. False: it finished meanwhile.
func handOverOne(ctx context.Context, pool *database.Pool, job Claim) (bool, error) {
	handed := false
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := lockDraftRowWithin(ctx, tx, job.Company, job.DraftID); err != nil {
			return err
		}
		const update = `
			UPDATE publish_jobs SET status = 'needs_attention', last_error = 'interrupted', updated_at = now()
			WHERE company_id = $1 AND id = $2 AND status = 'publishing' AND claimed_at < now() - make_interval(secs => $3)`
		tag, err := tx.Exec(ctx, update, job.Company.String(), job.JobID, staleAfter.Seconds())
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		handed = true
		if err := syncDraftWithin(ctx, tx, job.Company, job.DraftID); err != nil {
			return err
		}
		return recordWithin(ctx, tx, job.Company, Activity{Action: "needs_attention", DraftID: job.DraftID, JobID: job.JobID, ConnectionID: job.ConnectionID, Code: "interrupted"})
	})
	return handed, err
}

func lockDraftRowWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, draftID string) error {
	_, err := tx.Exec(ctx, `SELECT id FROM content_drafts WHERE company_id = $1 AND id = $2 FOR UPDATE`, company.String(), draftID)
	return err
}
