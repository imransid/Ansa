package database

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// TenantTables are the tables holding one company's data. A query naming one
// must also name company_id. TestTenantTablesAreEveryCompanyTable keeps it
// equal to the database: every table with a company_id is here, and each
// one's company_id may never be empty.
var TenantTables = []string{
	"contacts", "conversations", "messages", "assistant_activity", "assistant_settings",
	"channel_connections", "telegram_link_codes", "tickets", "ticket_activity", "categories",
	"orders", "order_items", "catalog_items", "autopost_slots", "content_drafts", "publish_jobs",
	"social_connections", "knowledge_articles", "knowledge_chunks", "business_facts",
	"inbound_emails", "outgoing_emails", "calls", "invites", "company_billing", "core_jobs",
	"autopublish_rules", "cofounder_activity", "post_metrics", "oauth_states", "company_documents", "inbound_addresses",
	"phone_lines", "knowledge_lookups",
	"onboarding_messages", "marketing_plans", "performance_reviews", "media_assets", "media_generation_jobs",
	"phone_calls", "away_summary_reads", "user_categories", "whatsapp_numbers",
}

// Statements allowed to read across companies: each is listed with why in
// CROSS_COMPANY.md, by the marker comment "-- cross-company: <reason>".
const crossCompanyMarker = "-- cross-company:"

var sqlString = regexp.MustCompile("(?s)`([^`]*)`")

// Every SQL statement in every Go file of core (tests aside: core/internal
// and the commands in core/cmd) that names a tenant table names company_id
// too, unless it is a listed cross-company read.
func TestEveryTenantQueryNamesTheCompany(t *testing.T) {
	for _, root := range []string{"..", filepath.Join("..", "..", "cmd")} {
		checkEveryStatementUnder(t, root)
	}
}

func checkEveryStatementUnder(t *testing.T, root string) {
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") || filepath.Base(path) == "testdb.go" {
			return err
		}
		source, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		for _, match := range sqlString.FindAllStringSubmatch(string(source), -1) {
			checkStatement(t, path, match[1])
		}
		return nil
	})
	if err != nil {
		t.Fatalf("reading the stores: %v", err)
	}
}

func checkStatement(t *testing.T, path, statement string) {
	lower := strings.ToLower(statement)
	if !strings.Contains(lower, "select") && !strings.Contains(lower, "insert") && !strings.Contains(lower, "update") && !strings.Contains(lower, "delete") {
		return
	}
	if strings.Contains(lower, crossCompanyMarker) {
		return
	}
	for _, table := range TenantTables {
		if regexp.MustCompile(`\b`+table+`\b`).MatchString(lower) && !strings.Contains(lower, "company_id") {
			t.Errorf("%s: a statement on %s doesn't name company_id:\n%s", path, table, statement)
		}
	}
}

func TestTheCheckCatchesAQueryWithoutTheCompany(t *testing.T) {
	inner := &testing.T{}
	checkStatement(inner, "example", "SELECT id FROM orders WHERE id = $1")
	if !inner.Failed() {
		t.Fatal("a query on orders without company_id must fail the check")
	}
	clean := &testing.T{}
	checkStatement(clean, "example", "SELECT id FROM orders WHERE company_id = $1 AND id = $2")
	if clean.Failed() {
		t.Fatal("a query naming company_id must pass")
	}
}

// The database's own catalog says which tables hold a company's data (a
// company_id column): every one is in TenantTables, so the check above reads
// its statements, and its company_id may never be empty. users is Better
// Auth's own table, reached by a person's id or address (CROSS_COMPANY.md
// lists those reads); its company_id is still never empty.
func TestTenantTablesAreEveryCompanyTable(t *testing.T) {
	pool := ForTest(t)
	rows, err := pool.Query(context.Background(), `
		SELECT columns.table_name, columns.is_nullable
		FROM information_schema.columns
		JOIN information_schema.tables ON tables.table_schema = columns.table_schema AND tables.table_name = columns.table_name
		WHERE columns.table_schema = 'public' AND columns.column_name = 'company_id' AND tables.table_type = 'BASE TABLE'`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	inDatabase := map[string]bool{}
	for rows.Next() {
		var table, nullable string
		if err := rows.Scan(&table, &nullable); err != nil {
			t.Fatal(err)
		}
		if nullable != "NO" {
			t.Errorf("%s.company_id may be empty", table)
		}
		inDatabase[table] = true
	}
	listed := map[string]bool{}
	for _, table := range TenantTables {
		listed[table] = true
		if !inDatabase[table] {
			t.Errorf("%s is in TenantTables but has no company_id", table)
		}
	}
	for table := range inDatabase {
		if !listed[table] && table != "users" {
			t.Errorf("%s holds company_id but isn't in TenantTables", table)
		}
	}
}
