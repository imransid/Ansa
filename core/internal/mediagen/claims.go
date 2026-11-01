package mediagen

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// A run first CLAIMS its job in ONE UPDATE, so two runs never both work
// it; every later write names the attempt it claimed, so a run that lost
// its claim (cut off, and another took over) never overwrites what the
// newer run decides. At most 3 runs; a run 15+ minutes old was cut off.

// Claimed is a job this run holds.
type Claimed struct {
	Kind, Prompt, Provider string
	// The service's id of a job an earlier run started: poll it, never ask again.
	ProviderJobID *string
	// This run's attempt (1, 2 or 3).
	Attempt int
	// The draft to attach the result to, and the version it was asked at.
	DraftID      *string
	DraftVersion *int
	RequestedBy  string
}

// claimJob claims one job of one company: one waiting to start, or one
// "being made" whose run started 15+ minutes ago and was tried fewer than
// 3 times. Nil when it isn't this company's or is taken, done or canceled.
func claimJob(ctx context.Context, pool *database.Pool, company tenant.CompanyID, jobID string) (*Claimed, error) {
	const claim = `
		UPDATE media_generation_jobs SET status = 'running', attempts = attempts + 1, started_at = now()
		WHERE company_id = $1 AND id = $2
			AND (status = 'queued' OR (status = 'running' AND started_at < now() - make_interval(mins => 15) AND attempts < 3))
		RETURNING kind, prompt, provider, provider_job_id, attempts, draft_id::text, draft_version, requested_by_user_id`
	var c Claimed
	err := pool.QueryRow(ctx, claim, company.String(), jobID).Scan(&c.Kind, &c.Prompt, &c.Provider, &c.ProviderJobID, &c.Attempt, &c.DraftID, &c.DraftVersion, &c.RequestedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

// giveUpInterrupted ends one job whose runs were all cut off (still "being
// made" 15+ minutes after its third run started). True when it did.
func giveUpInterrupted(ctx context.Context, pool *database.Pool, company tenant.CompanyID, jobID string) (bool, error) {
	tag, err := pool.Exec(ctx, `
		UPDATE media_generation_jobs SET status = 'failed', last_error = 'interrupted', finished_at = now()
		WHERE company_id = $1 AND id = $2 AND status = 'running' AND started_at < now() - make_interval(mins => 15) AND attempts >= 3`,
		company.String(), jobID)
	return err == nil && tag.RowsAffected() == 1, err
}

// saveProviderJobID keeps the service's own id of a job it runs in the
// background, while this run still holds the job: a later run polls it
// instead of asking (and paying) again.
func saveProviderJobID(ctx context.Context, pool *database.Pool, company tenant.CompanyID, jobID string, attempt int, providerJobID string) error {
	_, err := pool.Exec(ctx, `UPDATE media_generation_jobs SET provider_job_id = $4
		WHERE company_id = $1 AND id = $2 AND status = 'running' AND attempts = $3`, company.String(), jobID, attempt, providerJobID)
	return err
}

// failJob ends one job as failed with a code (never a message), if this
// run still holds it. A failed job never has an asset.
func failJob(ctx context.Context, pool *database.Pool, company tenant.CompanyID, jobID string, attempt int, code string, costCents *int) (bool, error) {
	tag, err := pool.Exec(ctx, `UPDATE media_generation_jobs SET status = 'failed', last_error = $4, cost_cents = $5, finished_at = now()
		WHERE company_id = $1 AND id = $2 AND status = 'running' AND attempts = $3`, company.String(), jobID, attempt, code, costCents)
	return err == nil && tag.RowsAffected() == 1, err
}
