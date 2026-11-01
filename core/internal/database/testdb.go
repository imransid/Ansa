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
		// Drafts point at media, media at the jobs that made them, and jobs
		// at media and drafts: those links go first (as the old cleanup did).
		for _, unlink := range []string{
			`UPDATE content_drafts SET media_asset_id = NULL WHERE company_id = $1`,
			`UPDATE media_generation_jobs SET asset_id = NULL, asset_deleted_at = now() WHERE company_id = $1 AND asset_id IS NOT NULL`,
		} {
			if _, err := pool.Exec(ctx, unlink, id); err != nil {
				t.Errorf("unlinking media: %v", err)
			}
		}
		// Children before parents (foreign keys), then the company. A table
		// missing from the list shows here, not as rows left behind.
		for _, table := range cleanupOrder {
			if _, err := pool.Exec(ctx, `DELETE FROM `+table+` WHERE company_id = $1`, id); err != nil {
				t.Errorf("cleaning %s: %v", table, err)
			}
		}
		if _, err := pool.Exec(ctx, `DELETE FROM companies WHERE id = $1`, id); err != nil {
			t.Errorf("cleaning the company (a table missing from cleanupOrder?): %v", err)
		}
	})
	return id
}

// The tables a test company's rows are deleted from, children first. A fixed
// list in code (never input), so the table name in the statement is safe.
var cleanupOrder = []string{
	"core_jobs", "knowledge_lookups", "cofounder_activity", "post_metrics", "publish_jobs", "autopublish_rules", "autopost_slots", "media_assets", "media_generation_jobs", "content_drafts", "marketing_plans", "performance_reviews", "onboarding_messages", "knowledge_chunks", "knowledge_articles", "company_documents", "inbound_addresses", "order_items", "orders", "catalog_items", "messages", "assistant_activity", "ticket_activity", "outgoing_emails", "inbound_emails", "tickets", "calls", "phone_lines",
	"user_categories", "categories",
	"conversations", "contacts", "channel_connections", "telegram_link_codes", "assistant_settings", "oauth_states", "social_connections",
	"away_summary_reads", "business_facts", "invites", "company_billing", "users",
}

// TestOwner adds a confirmed owner to a test company and returns their id.
func TestOwner(t *testing.T, pool *Pool, companyID string) string {
	t.Helper()
	var id string
	err := pool.QueryRow(context.Background(), `
		INSERT INTO users (id, company_id, role, name, email, email_verified)
		VALUES (gen_random_uuid()::text, $1, 'owner', 'Core Test Owner', gen_random_uuid()::text || '@core-test.example', true)
		RETURNING id`, companyID).Scan(&id)
	if err != nil {
		t.Fatalf("making a test owner: %v", err)
	}
	return id
}
