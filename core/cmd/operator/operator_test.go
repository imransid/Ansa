package main

import (
	"bytes"
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"ansa/core/internal/commands"
	"ansa/core/internal/database"
)

// testWorld is one test company with a confirmed owner, and the settings
// the commands read (the test database).
type testWorld struct {
	t         *testing.T
	pool      *database.Pool
	companyID string
	owner     string
	settings  map[string]string
}

func newTestWorld(t *testing.T) *testWorld {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	ownerID := database.TestOwner(t, pool, companyID)
	w := &testWorld{t: t, pool: pool, companyID: companyID, settings: baseSettings(os.Getenv("TEST_DATABASE_URL"))}
	if err := pool.QueryRow(context.Background(), `SELECT email FROM users WHERE company_id = $1 AND id = $2`, companyID, ownerID).Scan(&w.owner); err != nil {
		t.Fatalf("the owner's address: %v", err)
	}
	return w
}

// baseSettings are the settings every command needs (made-up secrets).
func baseSettings(databaseURL string) map[string]string {
	return map[string]string{
		"DATABASE_URL":        databaseURL,
		"DATA_ENCRYPTION_KEY": "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
		"BRAIN_SHARED_SECRET": strings.Repeat("b", 40),
		"BETTER_AUTH_SECRET":  strings.Repeat("a", 40),
		"ANSA_ENV":            "development",
	}
}

// run runs a command as `go run ./cmd/operator ...` would, and returns what
// it printed and its error.
func (w *testWorld) run(args ...string) (string, error) {
	var out bytes.Buffer
	err := run(context.Background(), args, func(name string) string { return w.settings[name] }, &out)
	return out.String(), err
}

func (w *testWorld) count(query string, args ...any) int {
	var n int
	if err := w.pool.QueryRow(context.Background(), query, append([]any{w.companyID}, args...)...).Scan(&n); err != nil {
		w.t.Fatalf("count: %v", err)
	}
	return n
}

// A wrong shape is the usage, before any setting is read (none is set here).
func TestTheUsageComesBeforeAnySetting(t *testing.T) {
	none := func(string) string { return "" }
	for _, args := range [][]string{
		{}, {"unknown"}, {"link-phone-line", "a@b.example"}, {"unlink-phone-line", "a@b.example", "pn-1", "extra"},
		{"show-forwarding-address", "a@b.example", "--yes"}, {"replace-forwarding-address"}, {"telegram-webhook", "set"}, {"telegram-webhook", "remove", "x"},
	} {
		err := run(context.Background(), args, none, &bytes.Buffer{})
		if err == nil || !strings.HasPrefix(err.Error(), "usage") {
			t.Fatalf("%v: %v", args, err)
		}
	}
}

// Only a confirmed, active owner's address finds a company, the command
// names the company and links nothing without --yes, and a number belongs
// to one company.
func TestLinkPhoneLineLinksOnlyWithYesForAnOwnersCompany(t *testing.T) {
	w := newTestWorld(t)
	number := "pn-operator-" + w.companyID
	lines := `SELECT count(*) FROM phone_lines WHERE company_id = $1 AND vapi_phone_number_id = $2`
	if _, err := w.run("link-phone-line", "stranger@core-test.example", number, "--yes"); !errors.Is(err, commands.ErrNoOwner) {
		t.Fatalf("an address that isn't an owner's: %v", err)
	}
	out, err := w.run("link-phone-line", w.owner, number)
	if err == nil || !strings.Contains(err.Error(), "Nothing was changed") || !strings.Contains(out, `Company: "core test company" (company id `+w.companyID+`)`) {
		t.Fatalf("without --yes: %q %v", out, err)
	}
	if w.count(lines, number) != 0 {
		t.Fatal("linked without --yes")
	}
	if out, err := w.run("link-phone-line", "--yes", strings.ToUpper(w.owner), number); err != nil || !strings.Contains(out, "Linked "+number) {
		t.Fatalf("with --yes: %q %v", out, err)
	}
	if w.count(lines, number) != 1 {
		t.Fatal("not linked")
	}
	if out, err := w.run("link-phone-line", w.owner, number, "--yes"); err != nil || !strings.Contains(out, "Already linked to this company.") {
		t.Fatalf("again: %q %v", out, err)
	}
	other := newTestWorld(t)
	if _, err := other.run("link-phone-line", other.owner, number, "--yes"); err == nil || !strings.Contains(err.Error(), "already belongs to another company") {
		t.Fatalf("another company: %v", err)
	}
	if _, err := w.run("link-phone-line", w.owner, "pn 1", "--yes"); err == nil || !strings.Contains(err.Error(), "isn't a Vapi phone number id") {
		t.Fatalf("a bad id: %v", err)
	}
}

func TestUnlinkPhoneLineUnlinksOnlyWithYesAndNeverANumberWithCalls(t *testing.T) {
	w := newTestWorld(t)
	number := "pn-operator-unlink-" + w.companyID
	if _, err := w.run("link-phone-line", w.owner, number, "--yes"); err != nil {
		t.Fatal(err)
	}
	if _, err := w.run("unlink-phone-line", w.owner, number); err == nil || !strings.Contains(err.Error(), "Nothing was changed") {
		t.Fatalf("without --yes: %v", err)
	}
	other := newTestWorld(t)
	if _, err := other.run("unlink-phone-line", other.owner, number, "--yes"); err == nil || !strings.Contains(err.Error(), "has no number") {
		t.Fatalf("another company's number: %v", err)
	}
	ctx := context.Background()
	var lineID string
	w.pool.QueryRow(ctx, `SELECT id FROM phone_lines WHERE company_id = $1 AND vapi_phone_number_id = $2`, w.companyID, number).Scan(&lineID)
	w.pool.Exec(ctx, `INSERT INTO calls (company_id, phone_line_id, vapi_call_id) VALUES ($1, $2, $3)`, w.companyID, lineID, "call-"+number)
	if _, err := w.run("unlink-phone-line", w.owner, number, "--yes"); err == nil || !strings.Contains(err.Error(), "already has calls") {
		t.Fatalf("a number with calls: %v", err)
	}
	w.pool.Exec(ctx, `DELETE FROM calls WHERE company_id = $1`, w.companyID)
	if out, err := w.run("unlink-phone-line", w.owner, number, "--yes"); err != nil || !strings.Contains(out, "Unlinked "+number) {
		t.Fatalf("unlinking: %q %v", out, err)
	}
	if w.count(`SELECT count(*) FROM phone_lines WHERE company_id = $1`) != 0 {
		t.Fatal("still linked")
	}
}

// The forwarding address is shown only on the production domain given, and
// replaced only with --yes, by the database's own new token.
func TestTheForwardingAddressIsShownAndReplacedOnlyWithItsDomain(t *testing.T) {
	w := newTestWorld(t)
	token := func() string {
		var value string
		w.pool.QueryRow(context.Background(), `SELECT inbound_token FROM companies WHERE id = $1`, w.companyID).Scan(&value)
		return value
	}
	before := token()
	if _, err := w.run("show-forwarding-address", w.owner); err == nil || !strings.Contains(err.Error(), "INBOUND_EMAIL_DOMAIN is not set") {
		t.Fatalf("without the domain: %v", err)
	}
	w.settings["INBOUND_EMAIL_DOMAIN"] = "inbound.example.test"
	if out, err := w.run("show-forwarding-address", w.owner); err != nil || !strings.HasSuffix(out, "c-"+before+"@inbound.example.test\n") {
		t.Fatalf("shown: %q %v", out, err)
	}
	if _, err := w.run("replace-forwarding-address", w.owner); err == nil || token() != before {
		t.Fatalf("without --yes nothing changes: %v", err)
	}
	out, err := w.run("replace-forwarding-address", w.owner, "--yes")
	after := token()
	if err != nil || after == before || !strings.Contains(out, "New forwarding address: c-"+after+"@inbound.example.test") {
		t.Fatalf("replaced: %q %v", out, err)
	}
}
