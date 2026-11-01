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

// claimNext claims the next due job core can publish (pairs: its draft's
// "platform:format", see claimable) in ONE UPDATE, the longest waiting
// first, skipping the companies in skip (onlyCompany: the tests keep to
// theirs). WHY "id = (subquery)": Postgres may run an IN subquery again for
// each row it looks at, and with SKIP LOCKED one UPDATE could then claim
// several. nil: none is due.
func claimNext(ctx context.Context, pool *database.Pool, skip []string, onlyCompany string, pairs []string) (*Claim, error) {
	const statement = `
		-- cross-company: the publishing queue serves every company; the claimed row's own company is used after.
		UPDATE publish_jobs SET status = 'publishing', claimed_at = now(), claim_id = gen_random_uuid(), attempts = attempts + 1, updated_at = now()
		WHERE id = (
			SELECT jobs.id FROM publish_jobs AS jobs
			JOIN content_drafts AS drafts ON drafts.company_id = jobs.company_id AND drafts.id = jobs.draft_id
			WHERE jobs.status = 'queued' AND jobs.run_after <= now()
				AND (drafts.platform || ':' || drafts.format) = ANY($3::text[])
				AND NOT (jobs.company_id::text = ANY($1::text[])) AND ($2 = '' OR jobs.company_id::text = $2)
			ORDER BY jobs.run_after, jobs.id
			FOR UPDATE OF jobs SKIP LOCKED
			LIMIT 1
		) AND status = 'queued'
		RETURNING company_id, id, draft_id, connection_id, claim_id, attempts`
	if skip == nil {
		skip = []string{}
	}
	return scanClaim(pool.QueryRow(ctx, statement, skip, onlyCompany, pairs))
}

// claimJob claims one job of one company in ONE UPDATE while it waits and
// is due, and core can publish it (right after scheduling it for now,
// "Publish now", a Retry). nil: another run has it, it was canceled, it
// isn't due, or it is the old runner's.
func claimJob(ctx context.Context, pool *database.Pool, company tenant.CompanyID, jobID string, pairs []string) (*Claim, error) {
	const statement = `
		UPDATE publish_jobs SET status = 'publishing', claimed_at = now(), claim_id = gen_random_uuid(), attempts = attempts + 1, updated_at = now()
		WHERE company_id = $1 AND id::text = $2 AND status = 'queued' AND run_after <= now()
			AND EXISTS (
				SELECT 1 FROM content_drafts AS drafts
				WHERE drafts.company_id = publish_jobs.company_id AND drafts.id = publish_jobs.draft_id
					AND (drafts.platform || ':' || drafts.format) = ANY($3::text[])
			)
		RETURNING company_id, id, draft_id, connection_id, claim_id, attempts`
	return scanClaim(pool.QueryRow(ctx, statement, company.String(), jobID, pairs))
}

// scanClaim reads a claim's RETURNING row (none: nothing was claimed).
func scanClaim(row pgx.Row) (*Claim, error) {
	var companyText string
	var claim Claim
	err := row.Scan(&companyText, &claim.JobID, &claim.DraftID, &claim.ConnectionID, &claim.ClaimID, &claim.Attempt)
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

func lockDraftRowWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, draftID string) error {
	_, err := tx.Exec(ctx, `SELECT id FROM content_drafts WHERE company_id = $1 AND id = $2 FOR UPDATE`, company.String(), draftID)
	return err
}
