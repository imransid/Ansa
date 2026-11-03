package main

import (
	"context"
	"os/exec"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
)

// The demo tool makes the whole demo through core's own functions, and a
// second run makes it again from nothing (one company per demo owner).
func TestTheDemoToolMakesTheWholeDemo(t *testing.T) {
	w := newTestWorld(t)
	demoForgetsRateLimits = false
	t.Cleanup(func() {
		demoForgetsRateLimits = true
		deleteDemoCompanies(t, w)
	})
	for run := 1; run <= 2; run++ {
		out, err := w.run("demo")
		if err != nil || !strings.Contains(out, "The demo is ready.") {
			t.Fatalf("run %d: %q %v", run, out, err)
		}
	}
	if companies := demoCompanies(t, w); len(companies) != 2 {
		t.Fatalf("two demo companies after two runs: %v", companies)
	}
	business := companyOf(t, w, demoBusinessEmail)
	for what, check := range map[string][2]any{
		"a member who handles deliveries":      {`SELECT count(*) FROM users WHERE company_id = $1 AND role = 'member' AND email_verified`, 1},
		"four request categories":              {`SELECT count(*) FROM categories WHERE company_id = $1`, 4},
		"four approved saved answers":          {`SELECT count(*) FROM knowledge_articles WHERE company_id = $1 AND status = 'approved'`, 4},
		"an order at each step":                {`SELECT count(DISTINCT status) FROM orders WHERE company_id = $1 AND status IN ('new', 'accepted', 'ready', 'done', 'cancelled')`, 5},
		"a reply waiting for the owner":        {`SELECT count(*) FROM messages WHERE company_id = $1 AND send_status = 'draft'`, 1},
		"a conversation the owner took over":   {`SELECT count(*) FROM conversations WHERE company_id = $1 AND handled_by = 'person'`, 1},
		"a conversation past its reply window": {`SELECT count(*) FROM conversations WHERE company_id = $1 AND last_customer_message_at < now() - interval '1 day'`, 1},
		"a price and a refund stopped":         {`SELECT count(*) FROM tickets WHERE company_id = $1 AND channel = 'chat' AND description ILIKE ANY (ARRAY['%price%', '%refund%'])`, 2},
		"requests closed without an email":     {`SELECT count(*) FROM tickets WHERE company_id = $1 AND solved_without_email`, 1},
		"a solved email and a bounced one":     {`SELECT count(*) FROM outgoing_emails WHERE company_id = $1`, 2},
		"the bounce":                           {`SELECT count(*) FROM outgoing_emails WHERE company_id = $1 AND delivery_problem = 'bounced'`, 1},
		"two finished calls":                   {`SELECT count(*) FROM calls WHERE company_id = $1`, 2},
		"three received emails":                {`SELECT count(*) FROM inbound_emails WHERE company_id = $1`, 3},
		"one to process again":                 {`SELECT count(*) FROM inbound_emails WHERE company_id = $1 AND ignored_reason = 'content_unavailable'`, 1},
		"a marketing plan":                     {`SELECT count(*) FROM marketing_plans WHERE company_id = $1`, 1},
		"numbers for five published posts":     {`SELECT count(DISTINCT publish_job_id) FROM post_metrics WHERE company_id = $1`, 5},
	} {
		if got := countIn(t, w, business, check[0].(string)); got != check[1].(int) {
			t.Errorf("%s: %d, want %d", what, got, check[1])
		}
	}
	if _, err := exec.LookPath("say"); err == nil && countIn(t, w, business, `SELECT count(*) FROM calls WHERE company_id = $1 AND recording_status = 'stored'`) != 1 {
		t.Error("a call with its recording (made by say)")
	}
	person := companyOf(t, w, demoPersonEmail)
	if countIn(t, w, person, `SELECT count(*) FROM assistant_settings WHERE company_id = $1 AND away_since IS NOT NULL`) != 1 ||
		countIn(t, w, person, `SELECT count(*) FROM contacts WHERE company_id = $1 AND important`) != 1 {
		t.Error("Rafa is away, with one important person")
	}
}

func demoCompanies(t *testing.T, w *testWorld) []string {
	rows, err := w.pool.Query(context.Background(), `SELECT DISTINCT company_id::text FROM users WHERE email LIKE '%' || $1`, demoDomain)
	if err != nil {
		t.Fatal(err)
	}
	companies, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	return companies
}

func companyOf(t *testing.T, w *testWorld, address string) string {
	var company string
	if err := w.pool.QueryRow(context.Background(), `SELECT company_id::text FROM users WHERE email = $1`, address).Scan(&company); err != nil {
		t.Fatalf("%s: %v", address, err)
	}
	return company
}

func countIn(t *testing.T, w *testWorld, company, query string) int {
	var n int
	if err := w.pool.QueryRow(context.Background(), query, company).Scan(&n); err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return n
}

func deleteDemoCompanies(t *testing.T, w *testWorld) {
	for _, company := range demoCompanies(t, w) {
		w.pool.Exec(context.Background(), `DELETE FROM verifications WHERE value IN (SELECT id FROM users WHERE company_id = $1)`, company)
		if err := database.DeleteTestCompany(context.Background(), w.pool, company); err != nil {
			t.Errorf("deleting a demo company: %v", err)
		}
	}
}
