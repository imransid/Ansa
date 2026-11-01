package mediagen

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/drafts"
	"ansa/core/internal/media"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// The outcomes of saving a result.
const (
	saved       = "saved"
	lostClaim   = "lost-claim"
	libraryFull = "library-full"
)

// generatedFile is a checked result, already in storage.
type generatedFile struct {
	assetID, storageKey, kind, contentType string
	size                                   int
	width, height                          any
	provider                               string
	costCents                              *int
}

// saveGenerated saves what one job made in ONE transaction: the asset, the
// job succeeded and linked to it, and, when it was asked from a draft that
// still takes it, the draft with it attached as its next version, without
// its approval. lostClaim: another run holds the job now, nothing written.
// libraryFull: no room (300 files, 500 MB), the job failed, no asset.
// Lock order: the company (its row lock FIRST, so two saves can't both
// pass the cap), the person, the draft, the job.
func saveGenerated(ctx context.Context, pool *database.Pool, company tenant.CompanyID, jobID string, claimed *Claimed, file generatedFile) (string, error) {
	outcome := ""
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		role, draft, err := lockRequesterAndDraft(ctx, tx, company, claimed)
		if err != nil {
			return err
		}
		var heldID string
		err = tx.QueryRow(ctx, `SELECT id::text FROM media_generation_jobs WHERE company_id = $1 AND id = $2 AND status = 'running' AND attempts = $3 FOR UPDATE`,
			company.String(), jobID, claimed.Attempt).Scan(&heldID)
		if errors.Is(err, pgx.ErrNoRows) {
			outcome = lostClaim
			return nil
		}
		if err != nil {
			return err
		}
		if outcome, err = keepWithin(ctx, tx, company, jobID, claimed, file); err != nil || outcome != saved {
			return err
		}
		if role != "" && draft != nil && claimed.DraftVersion != nil {
			_, err = media.AttachGeneratedWithin(ctx, tx, company, claimed.RequestedBy, *claimed.DraftID, draft, *claimed.DraftVersion, file.assetID, file.kind)
		}
		return err
	})
	return outcome, err
}

// lockRequesterAndDraft: the result is attached on behalf of whoever
// asked, only while they are still in the company.
func lockRequesterAndDraft(ctx context.Context, tx database.Tx, company tenant.CompanyID, claimed *Claimed) (string, *drafts.LockedContent, error) {
	if claimed.DraftID == nil {
		return "", nil, nil
	}
	role, err := team.RoleWithin(ctx, tx, company, claimed.RequestedBy)
	if err != nil {
		return "", nil, err
	}
	draft, err := drafts.LockContentWithin(ctx, tx, company, *claimed.DraftID)
	if errors.Is(err, drafts.ErrNotFound) {
		return role, nil, nil
	}
	return role, draft, err
}

// keepWithin checks the cap (counted inside the transaction) and writes
// the asset and the job's success, or the job's "library_full".
func keepWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, jobID string, claimed *Claimed, file generatedFile) (string, error) {
	count, total, err := media.Totals(ctx, tx, company)
	if err != nil {
		return "", err
	}
	if count+1 > media.MaxAssetsPerCompany || total+file.size > media.MaxBytesPerCompany {
		_, err := tx.Exec(ctx, `UPDATE media_generation_jobs SET status = 'failed', last_error = 'library_full', cost_cents = $4, finished_at = now()
			WHERE company_id = $1 AND id = $2 AND status = 'running' AND attempts = $3`, company.String(), jobID, claimed.Attempt, file.costCents)
		return libraryFull, err
	}
	// Every column named, never a spread of what was passed in.
	const insert = `
		INSERT INTO media_assets (id, company_id, kind, source, content_type, size_bytes, width, height, storage_key, generation_job_id, provider, created_by_user_id)
		VALUES ($1, $2, $3, 'generated', $4, $5, $6, $7, $8, $9, $10, $11)`
	if _, err := tx.Exec(ctx, insert, file.assetID, company.String(), file.kind, file.contentType, file.size, file.width, file.height,
		file.storageKey, jobID, file.provider, claimed.RequestedBy); err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, `UPDATE media_generation_jobs SET status = 'succeeded', asset_id = $4, cost_cents = $5, finished_at = now()
		WHERE company_id = $1 AND id = $2 AND status = 'running' AND attempts = $3`, company.String(), jobID, claimed.Attempt, file.assetID, file.costCents)
	return saved, err
}
