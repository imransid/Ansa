package database

import (
	"context"
	"os"
	"testing"
)

// ForTest opens the local test database from TEST_DATABASE_URL, or skips the
// test when it isn't set (make test sets it from ../.env.core). Never point
// it at a production database: tests write and delete rows.
func ForTest(t *testing.T) *Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL isn't set: database tests skipped")
	}
	pool, err := Open(context.Background(), url)
	if err != nil {
		t.Fatalf("opening the test database: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// TestCompany makes a company of its own for one test and deletes it (with
// the rows the test made in core's tables) when the test ends.
func TestCompany(t *testing.T, pool *Pool) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := pool.QueryRow(ctx, `INSERT INTO companies (name) VALUES ('core test company') RETURNING id`).Scan(&id); err != nil {
		t.Fatalf("making a test company: %v", err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM core_jobs WHERE company_id = $1`, id)
		pool.Exec(ctx, `DELETE FROM companies WHERE id = $1`, id)
	})
	return id
}
