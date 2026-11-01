package jobs

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// queryer is a pool or a transaction.
type queryer interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func insertJob(ctx context.Context, pool *database.Pool, company tenant.CompanyID, job NewJob, payload []byte) (string, error) {
	return insertJobOn(ctx, pool, company, job, payload)
}

func insertJobWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, job NewJob, payload []byte) (string, error) {
	return insertJobOn(ctx, tx, company, job, payload)
}

func insertJobOn(ctx context.Context, db queryer, company tenant.CompanyID, job NewJob, payload []byte) (string, error) {
	const statement = `
		INSERT INTO core_jobs (company_id, kind, payload, run_after, max_attempts, dedupe_key)
		VALUES ($1, $2, $3, COALESCE($4, now()), $5, NULLIF($6, ''))
		RETURNING id`
	var runAfter *time.Time
	if !job.RunAfter.IsZero() {
		runAfter = &job.RunAfter
	}
	var id string
	err := db.QueryRow(ctx, statement, company.String(), job.Kind, payload, runAfter, job.MaxAttempts, job.DedupeKey).Scan(&id)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return "", ErrDuplicate
	}
	return id, err
}

// claimNext takes the next due job of any company, or nil when none is due.
func claimNext(ctx context.Context, pool *database.Pool) (*Job, error) {
	const statement = `
		-- cross-company: workers serve every company; the job then runs with its own company.
		UPDATE core_jobs SET status = 'running', claimed_at = now(), attempts = attempts + 1
		WHERE id = (
			SELECT id FROM core_jobs
			WHERE status = 'queued' AND run_after <= now()
			ORDER BY run_after
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		)
		RETURNING id, company_id, kind, payload, attempts`
	var job Job
	var company string
	err := pool.QueryRow(ctx, statement).Scan(&job.ID, &company, &job.Kind, &job.Payload, &job.Attempt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	job.CompanyID, err = tenant.FromTrustedSource(company)
	return &job, err
}

func markDone(ctx context.Context, pool *database.Pool, job *Job) error {
	const statement = `
		UPDATE core_jobs SET status = 'done', finished_at = now(), last_error_code = NULL
		WHERE company_id = $1 AND id = $2 AND status = 'running'`
	_, err := pool.Exec(ctx, statement, job.CompanyID.String(), job.ID)
	return err
}

// markFailed queues the job again after its backoff, or fails it for good
// once its tries are used up (or the failure is permanent).
func markFailed(ctx context.Context, pool *database.Pool, job *Job, code string, permanent bool) error {
	const statement = `
		UPDATE core_jobs SET
			status = CASE WHEN $3 OR attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
			finished_at = CASE WHEN $3 OR attempts >= max_attempts THEN now() ELSE NULL END,
			run_after = now() + make_interval(secs => $4),
			last_error_code = $5
		WHERE company_id = $1 AND id = $2 AND status = 'running'`
	_, err := pool.Exec(ctx, statement, job.CompanyID.String(), job.ID, permanent, Backoff(job.Attempt).Seconds(), code)
	return err
}

// handBackStuck queues again (or fails) jobs whose worker died: running
// longer than the lease. Returns how many.
func handBackStuck(ctx context.Context, pool *database.Pool, lease time.Duration) (int64, error) {
	const statement = `
		-- cross-company: a dead worker's jobs, by age only; ids are not even returned.
		UPDATE core_jobs SET
			status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
			finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
			last_error_code = 'interrupted'
		WHERE status = 'running' AND claimed_at < now() - make_interval(secs => $1)`
	tag, err := pool.Exec(ctx, statement, lease.Seconds())
	return tag.RowsAffected(), err
}
