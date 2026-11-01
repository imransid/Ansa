package database

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// TenantTables are the tables holding one company's data. A query naming one
// must also name company_id. Keep it equal to the database (the old checks
// prove every tenant table has a NOT NULL company_id).
var TenantTables = []string{
	"contacts", "conversations", "messages", "assistant_activity", "assistant_settings",
	"channel_connections", "telegram_link_codes", "tickets", "ticket_activity", "categories",
	"orders", "order_items", "catalog_items", "autopost_slots", "content_drafts", "publish_jobs",
	"social_connections", "knowledge_articles", "knowledge_chunks", "business_facts",
	"inbound_emails", "outgoing_emails", "calls", "invites", "company_billing", "core_jobs",
	"autopublish_rules", "cofounder_activity", "post_metrics", "oauth_states", "company_documents", "inbound_addresses",
	"phone_lines", "knowledge_lookups",
	"onboarding_messages", "marketing_plans", "performance_reviews", "media_assets", "media_generation_jobs",
}

// Statements allowed to read across companies: each is listed with why in
// CROSS_COMPANY.md, by the marker comment "-- cross-company: <reason>".
const crossCompanyMarker = "-- cross-company:"

var sqlString = regexp.MustCompile("(?s)`([^`]*)`")

// Every SQL statement in every Go file of core (tests aside) that names a
// tenant table names company_id too, unless it is a listed cross-company read.
func TestEveryTenantQueryNamesTheCompany(t *testing.T) {
	root := filepath.Join("..")
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
