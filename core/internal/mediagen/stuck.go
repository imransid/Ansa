package mediagen

import (
	"context"
	"time"

	"ansa/core/internal/tenant"
)

// The periodic task: requests still waiting 2+ minutes after they were made
// (their run never started: a restart right after the answer), or being
// made 15+ minutes after their run started (it was cut off; a third such
// one is ended "interrupted" by its own claim), of every company, least
// recently tried first. Each then runs through its company-scoped path.

// The most requests one round takes up, and how long a round may last.
const (
	stuckBatch       = 25
	stuckRoundBudget = 300 * time.Second
)

// stuckJob is one stuck request: ids only.
type stuckJob struct {
	company tenant.CompanyID
	jobID   string
}

// findStuck lists stuck requests of every company (a listed cross-company read).
func (s *Service) findStuck(ctx context.Context, limit int) ([]stuckJob, error) {
	const statement = `
		-- cross-company: the stuck-run finder serves every company; ids only, each request then runs through its company-scoped path.
		SELECT company_id::text, id::text FROM media_generation_jobs
		WHERE status IN ('queued', 'running')
			AND ((status = 'queued' AND created_at < now() - make_interval(mins => 2))
				OR (status = 'running' AND started_at < now() - make_interval(mins => 15)))
		ORDER BY COALESCE(started_at, created_at) LIMIT $1`
	rows, err := s.Pool.Query(ctx, statement, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var stuck []stuckJob
	for rows.Next() {
		var companyID, jobID string
		if err := rows.Scan(&companyID, &jobID); err != nil {
			return nil, err
		}
		company, err := tenant.FromTrustedSource(companyID)
		if err != nil {
			return nil, err
		}
		stuck = append(stuck, stuckJob{company: company, jobID: jobID})
	}
	return stuck, rows.Err()
}

// RunStuck takes up stuck requests, each started only while its slowest
// run still ends inside the round's budget. It returns how many it ran.
func (s *Service) RunStuck(ctx context.Context) (int, error) {
	started := time.Now()
	stuck, err := s.findStuck(ctx, stuckBatch)
	if err != nil {
		return 0, err
	}
	ran := 0
	for _, job := range stuck {
		if time.Since(started)+LongestRun > stuckRoundBudget || ctx.Err() != nil {
			break
		}
		s.Run(ctx, job.company, job.jobID)
		ran++
	}
	return ran, nil
}
