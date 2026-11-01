package maintenance

import (
	"context"
	"io"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/logging"
)

func TestOnlyRowsNobodyCanUseAreDeleted(t *testing.T) {
	pool := database.ForTest(t)
	ctx := context.Background()
	companyID := database.TestCompany(t, pool)
	owner := database.TestOwner(t, pool, companyID)
	exec := func(statement string, args ...any) {
		if _, err := pool.Exec(ctx, statement, args...); err != nil {
			t.Fatalf("setup: %v", err)
		}
	}
	exec(`INSERT INTO oauth_states (id, company_id, user_id, platform, state_hash, created_at, expires_at) VALUES (gen_random_uuid(), $1, $2, 'facebook', repeat('a', 64), now() - interval '11 minutes', now() - interval '1 minute')`, companyID, owner)
	exec(`INSERT INTO oauth_states (id, company_id, user_id, platform, state_hash, expires_at) VALUES (gen_random_uuid(), $1, $2, 'facebook', repeat('b', 64), now() + interval '10 minutes')`, companyID, owner)
	exec(`INSERT INTO core_jobs (company_id, kind, payload, status, run_after, finished_at) VALUES ($1, 'test.old', '{}', 'done', now(), now() - interval '31 days')`, companyID)
	exec(`INSERT INTO core_jobs (company_id, kind, payload, status, run_after, finished_at) VALUES ($1, 'test.recent', '{}', 'failed', now(), now() - interval '1 day')`, companyID)
	exec(`INSERT INTO core_jobs (company_id, kind, payload, status, run_after) VALUES ($1, 'test.waiting', '{}', 'queued', now() - interval '40 days')`, companyID)
	// Only this test's company: the tables of no company are left as they are.
	if _, err := Cleanup(ctx, pool, logging.New(io.Discard), companyID); err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	var states, jobs int
	pool.QueryRow(ctx, `SELECT count(*) FROM oauth_states WHERE company_id = $1`, companyID).Scan(&states)
	pool.QueryRow(ctx, `SELECT count(*) FROM core_jobs WHERE company_id = $1`, companyID).Scan(&jobs)
	if states != 1 || jobs != 2 {
		t.Fatalf("kept: %d attempts, %d jobs", states, jobs)
	}
}
