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
	exec(`INSERT INTO device_pair_codes (company_id, created_by_user_id, code_hash, created_at, expires_at) VALUES ($1, $2, repeat('c', 64), now() - interval '6 minutes', now() - interval '1 minute')`, companyID, owner)
	exec(`INSERT INTO device_pair_codes (company_id, created_by_user_id, code_hash, expires_at) VALUES ($1, $2, repeat('d', 64), now() + interval '5 minutes')`, companyID, owner)
	// Only this test's company: the tables of no company are left as they are.
	if _, err := Cleanup(ctx, pool, logging.New(io.Discard), companyID); err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	var states, jobs, codes int
	pool.QueryRow(ctx, `SELECT count(*) FROM oauth_states WHERE company_id = $1`, companyID).Scan(&states)
	pool.QueryRow(ctx, `SELECT count(*) FROM core_jobs WHERE company_id = $1`, companyID).Scan(&jobs)
	pool.QueryRow(ctx, `SELECT count(*) FROM device_pair_codes WHERE company_id = $1 AND code_hash = repeat('d', 64)`, companyID).Scan(&codes)
	if states != 1 || jobs != 2 || codes != 1 {
		t.Fatalf("kept: %d attempts, %d jobs, %d pair codes", states, jobs, codes)
	}
	pool.QueryRow(ctx, `SELECT count(*) FROM device_pair_codes WHERE company_id = $1`, companyID).Scan(&codes)
	if codes != 1 {
		t.Fatalf("the expired pair code goes: %d left", codes)
	}
}
