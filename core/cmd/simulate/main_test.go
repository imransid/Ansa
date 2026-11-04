package main

import (
	"bytes"
	"context"
	"os"
	"strings"
	"testing"

	"ansa/core/internal/analytics"
	"ansa/core/internal/database"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

const testKey = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc="

// testWorld is one test company with a confirmed owner, and the settings
// the tools read (the test database, a development folder of its own).
type testWorld struct {
	t        *testing.T
	pool     *database.Pool
	company  tenant.CompanyID
	ownerID  string
	owner    string
	box      *secure.Box
	settings map[string]string
}

func newTestWorld(t *testing.T) *testWorld {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	box, _ := secure.NewBox(testKey)
	w := &testWorld{t: t, pool: pool, company: company, ownerID: database.TestOwner(t, pool, companyID), box: box, settings: baseSettings(os.Getenv("TEST_DATABASE_URL"))}
	w.settings["ANSA_DEV_FOLDER"] = t.TempDir()
	if err := pool.QueryRow(context.Background(), `SELECT email FROM users WHERE company_id = $1 AND id = $2`, companyID, w.ownerID).Scan(&w.owner); err != nil {
		t.Fatalf("the owner's address: %v", err)
	}
	return w
}

// baseSettings are the settings every tool needs (made-up secrets).
func baseSettings(databaseURL string) map[string]string {
	return map[string]string{
		"DATABASE_URL":        databaseURL,
		"DATA_ENCRYPTION_KEY": testKey,
		"BRAIN_SHARED_SECRET": strings.Repeat("b", 40),
		"BETTER_AUTH_SECRET":  strings.Repeat("a", 40),
		"ANSA_ENV":            "development",
	}
}

// run runs a tool as `go run ./cmd/simulate ...` would; returns what it printed.
func (w *testWorld) run(args ...string) (string, error) {
	return runWith(w.settings, args...)
}

func runWith(settings map[string]string, args ...string) (string, error) {
	var out bytes.Buffer
	err := run(context.Background(), args, func(name string) string { return settings[name] }, &out)
	return out.String(), err
}

func (w *testWorld) count(query string, args ...any) int {
	var n int
	if err := w.pool.QueryRow(context.Background(), query, append([]any{w.company.String()}, args...)...).Scan(&n); err != nil {
		w.t.Fatalf("count: %v", err)
	}
	return n
}

// forgetRateLimits deletes the counters the test's webhooks made.
func (w *testWorld) forgetRateLimits(pairs ...[2]string) {
	limiter := ratelimit.New(w.pool, w.settings["BETTER_AUTH_SECRET"])
	var keys []string
	for _, pair := range pairs {
		keys = append(keys, limiter.Key(pair[0], pair[1]))
	}
	w.t.Cleanup(func() { w.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = ANY($1)`, keys) })
}

// Each tool's arguments in the right shape, to reach its guard.
var argumentsOfEveryTool = map[string][]string{
	"message":        {"owner@x.example", "Lena", "Hello"},
	"post-metrics":   {"00000000-0000-4000-8000-000000000000", "views=1"},
	"vapi-call":      {"pn-1"},
	"vapi-tool-call": {"pn-1", "When are you open?"},
	"solved-call":    {"owner@x.example", "pn-1"},
	"try-brain":      {"owner@x.example", "00000000-0000-4000-8000-000000000000"},
	"inbound-email":  {"owner@x.example"},
	"email-bounce":   {"some-email.html"},
	"telegram":       {"owner@x.example", "Lena", "Hello"},
	"telegram-poll":  {},
	"messenger":      {"owner@x.example", "Lena", "Hello"},
	"whatsapp":       {"owner@x.example", "Lena", "Hello"},
	"seed-tickets":   {"owner@x.example"},
	"demo":           {},
}

// Every tool writes or sends something made up: never in production, never
// to a database that isn't on this computer (refused before anything is
// read or sent: these databases don't exist).
func TestEveryToolRefusesProductionAndADatabaseElsewhere(t *testing.T) {
	if len(argumentsOfEveryTool) != len(allTools()) {
		t.Fatal("every tool is in the list")
	}
	elsewhere := baseSettings("postgres://ansa@db.example.com:5432/ansa")
	production := baseSettings("postgres://ansa@localhost:5432/ansa")
	for name, value := range map[string]string{"ANSA_ENV": "production", "APP_URL": "https://app.example.com", "SEND_REAL_EMAIL": "true",
		"EMAIL_FROM": "ansa@example.com", "RESEND_API_KEY": "re_made_up", "INBOUND_EMAIL_DOMAIN": "inbound.example.com",
		"USE_R2_STORAGE": "true", "R2_ACCOUNT_ID": "a", "R2_ACCESS_KEY_ID": "b", "R2_SECRET_ACCESS_KEY": "c", "R2_BUCKET": "d",
		"DEVICE_API_URL": "https://core.example.com"} {
		production[name] = value
	}
	for name, args := range argumentsOfEveryTool {
		if _, err := runWith(elsewhere, append([]string{name}, args...)...); err == nil || !strings.Contains(err.Error(), "refusing to run") || !strings.Contains(err.Error(), "DATABASE_URL") {
			t.Fatalf("%s, a database elsewhere: %v", name, err)
		}
		if _, err := runWith(production, append([]string{name}, args...)...); err == nil || !strings.Contains(err.Error(), "ANSA_ENV is production") {
			t.Fatalf("%s, production: %v", name, err)
		}
	}
}

// A wrong shape is the usage, before any setting is read (none is set here).
func TestTheUsageComesBeforeAnySetting(t *testing.T) {
	if _, err := runWith(map[string]string{}, "post-metrics"); err == nil || err.Error() != analytics.SimulateUsage || !strings.Contains(err.Error(), "video_views=<number>") {
		t.Fatalf("post-metrics without a post and numbers: %v", err)
	}
	for _, args := range [][]string{
		{}, {"unknown"}, {"message", "a@b.example", "Lena"}, {"telegram", "a@b.example", " ", "hi"}, {"vapi-call"},
		{"vapi-call", "pn-1", "valid", "extra"}, {"vapi-call", "pn-1", "--core"}, {"vapi-tool-call", "pn-1"},
		{"vapi-tool-call", "pn-1", "q", "--call"}, {"telegram-poll", "now"}, {"try-brain", "a@b.example"}, {"demo", "now"},
	} {
		if _, err := runWith(map[string]string{}, args...); err == nil || !strings.HasPrefix(err.Error(), "usage") {
			t.Fatalf("%v: %v", args, err)
		}
	}
}
