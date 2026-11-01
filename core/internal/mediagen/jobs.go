package mediagen

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/drafts"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// Saving and reading one company's requests. A request is "stuck" when it
// waited longer than a run takes to start (2+ minutes queued) or was being
// made longer than a run can last (15+ minutes running): by the database's
// clock, like the claim. Anyone may then start it again (a claim decides).

// newJob is a request to save; draftID "" = from the media page.
type newJob struct {
	kind, prompt, provider string
	draftID                string
	draftVersion           int
}

// createJob saves a request by actorUserID while active in the company. A
// draft to attach the result to must be the company's, editable, of the
// format that takes this kind and at the version the page showed. Lock
// order: the person, the draft, its requests (as a result's save does). A
// stuck request of the same draft is ended "superseded" first, so it can
// never attach an older image later, nor be paid for; the draft's row lock
// makes two requests at once wait for each other (a unique index allows
// one open request per draft too).
func createJob(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, job newJob) (string, string, error) {
	var id, refusal string
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role == "" {
			refusal = cantAddMedia
			return err
		}
		if job.draftID != "" {
			if refusal, err = prepareDraftWithin(ctx, tx, company, job); err != nil || refusal != "" {
				return err
			}
		}
		const insert = `
			INSERT INTO media_generation_jobs (company_id, kind, prompt, provider, draft_id, draft_version, requested_by_user_id)
			VALUES ($1, $2, $3, $4, NULLIF($5, '')::uuid, NULLIF($6, 0), $7) RETURNING id::text`
		return tx.QueryRow(ctx, insert, company.String(), job.kind, job.prompt, job.provider, job.draftID, job.draftVersion, actorUserID).Scan(&id)
	})
	return id, refusal, err
}

// prepareDraftWithin locks the draft a request is for and checks it takes
// one now, or says why not.
func prepareDraftWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, job newJob) (string, error) {
	draft, err := drafts.LockContentWithin(ctx, tx, company, job.draftID)
	switch {
	case errors.Is(err, drafts.ErrNotFound):
		return draftGone, nil
	case err != nil:
		return "", err
	case drafts.MediaKindOfFormat(draft.Format) != job.kind:
		return wrongFormat, nil
	case !drafts.In(drafts.EditableStatuses, draft.Status):
		return notEditable, nil
	case draft.Version != job.draftVersion:
		return draftStale, nil
	}
	rows, err := tx.Query(ctx, `
		SELECT id::text, COALESCE((status = 'queued' AND created_at < now() - make_interval(mins => 2))
			OR (status = 'running' AND started_at < now() - make_interval(mins => 15)), false)
		FROM media_generation_jobs WHERE company_id = $1 AND draft_id = $2 AND status IN ('queued', 'running') FOR UPDATE`, company.String(), job.draftID)
	if err != nil {
		return "", err
	}
	var stuck []string
	busy := false
	for rows.Next() {
		var id string
		var isStuck bool
		if err := rows.Scan(&id, &isStuck); err != nil {
			rows.Close()
			return "", err
		}
		busy = busy || !isStuck
		stuck = append(stuck, id)
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	if busy {
		return draftBusy, nil
	}
	_, err = tx.Exec(ctx, `UPDATE media_generation_jobs SET status = 'failed', last_error = 'superseded', finished_at = now()
		WHERE company_id = $1 AND id = ANY($2::uuid[])`, company.String(), stuck)
	return "", err
}

// OpenJob is a draft's request still waiting or being made.
type OpenJob struct {
	ID        string    `json:"id"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
	// The version it was asked at (its image is attached only at it).
	DraftVersion *int `json:"-"`
	IsStuck      bool `json:"isStuck"`
}

// OpenJobOfDraft is the request of one draft still waiting or being made
// (there is at most one), or nil.
func OpenJobOfDraft(ctx context.Context, pool *database.Pool, company tenant.CompanyID, draftID string) (*OpenJob, error) {
	var job OpenJob
	err := pool.QueryRow(ctx, `
		SELECT id::text, status, created_at, draft_version, COALESCE((status = 'queued' AND created_at < now() - make_interval(mins => 2))
			OR (status = 'running' AND started_at < now() - make_interval(mins => 15)), false)
		FROM media_generation_jobs WHERE company_id = $1 AND draft_id = $2 AND status IN ('queued', 'running')
		ORDER BY created_at DESC LIMIT 1`, company.String(), draftID).Scan(&job.ID, &job.Status, &job.CreatedAt, &job.DraftVersion, &job.IsStuck)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &job, err
}

// Cancel cancels one request of one company, only while it waits to
// start: once a run claimed it, the service may already be making (and
// charging for) it. "canceled", "wrong-status", "not-found" or "not-allowed".
func Cancel(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, jobID string) (string, error) {
	outcome := ""
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if role, err := team.RoleWithin(ctx, tx, company, actorUserID); err != nil || role == "" {
			outcome = "not-allowed"
			return err
		}
		tag, err := tx.Exec(ctx, `UPDATE media_generation_jobs SET status = 'canceled', finished_at = now()
			WHERE company_id = $1 AND id = $2 AND status = 'queued'`, company.String(), jobID)
		if err != nil || tag.RowsAffected() == 1 {
			outcome = "canceled"
			return err
		}
		var exists bool
		err = tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM media_generation_jobs WHERE company_id = $1 AND id = $2)`, company.String(), jobID).Scan(&exists)
		outcome = "not-found"
		if exists {
			outcome = "wrong-status"
		}
		return err
	})
	return outcome, err
}

// IsStuck says whether one request of one company is stuck (nil: unknown).
func IsStuck(ctx context.Context, pool *database.Pool, company tenant.CompanyID, jobID string) (*bool, error) {
	var stuck bool
	err := pool.QueryRow(ctx, `
		SELECT COALESCE((status = 'queued' AND created_at < now() - make_interval(mins => 2))
			OR (status = 'running' AND started_at < now() - make_interval(mins => 15)), false)
		FROM media_generation_jobs WHERE company_id = $1 AND id = $2`, company.String(), jobID).Scan(&stuck)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &stuck, err
}
