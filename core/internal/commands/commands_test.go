package commands

import (
	"context"
	"strings"
	"testing"

	"ansa/core/internal/config"
	"ansa/core/internal/database"
)

// addPerson adds someone to a test company and returns their address.
func addPerson(t *testing.T, pool *database.Pool, companyID, role string, confirmed, removed bool) string {
	t.Helper()
	var email string
	err := pool.QueryRow(context.Background(), `
		INSERT INTO users (id, company_id, role, name, email, email_verified, deactivated_at)
		VALUES ('id' || substr(md5(random()::text) || md5(random()::text), 1, 30), $1, $2, 'Test person', gen_random_uuid()::text || '@core-test.example', $3,
			CASE WHEN $4 THEN now() ELSE NULL END)
		RETURNING email`, companyID, role, confirmed, removed).Scan(&email)
	if err != nil {
		t.Fatalf("adding a person: %v", err)
	}
	return email
}

// Only a confirmed, active OWNER's address finds a company: never a member,
// someone who never confirmed (an invite to someone else's address) or a
// removed owner.
func TestOnlyAConfirmedActiveOwnersAddressFindsTheCompany(t *testing.T) {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	ctx := context.Background()
	owner := addPerson(t, pool, companyID, "owner", true, false)
	found, err := FindOwnersCompany(ctx, pool, "  "+strings.ToUpper(owner)+" ")
	if err != nil || found.ID.String() != companyID || found.Name != "core test company" || found.OwnerID == "" {
		t.Fatalf("the owner's address, in capitals with spaces: %+v, %v", found, err)
	}
	for _, other := range []string{
		addPerson(t, pool, companyID, "member", true, false),
		addPerson(t, pool, companyID, "owner", false, false),
		addPerson(t, pool, companyID, "owner", true, true),
		"nobody@core-test.example",
	} {
		if _, err := FindOwnersCompany(ctx, pool, other); err != ErrNoOwner {
			t.Fatalf("%s must find nothing: %v", other, err)
		}
	}
	if line := Describe(found); line != `Company: "core test company" (company id `+companyID+`)` {
		t.Fatalf("the company's line: %s", line)
	}
}

func TestYesIsTakenOutWhereverItIs(t *testing.T) {
	values, confirmed := SplitConfirm([]string{"--yes", "a@b.example", "pn-1"})
	if !confirmed || strings.Join(values, " ") != "a@b.example pn-1" {
		t.Fatalf("got %v %v", values, confirmed)
	}
	if _, confirmed := SplitConfirm([]string{"a@b.example", "--yess"}); confirmed {
		t.Fatal("only --yes itself confirms")
	}
}

// The development tools write made-up rows: never in production, only to a
// database on this computer, and they send webhooks only to a core on it.
func TestTheDevelopmentToolsRunOnlyOnThisComputer(t *testing.T) {
	local := "postgres://ansa@localhost:5432/ansa"
	if ReasonNotToRun(config.Config{Environment: "production", DatabaseURL: local}) == "" {
		t.Fatal("production is refused")
	}
	for _, elsewhere := range []string{"postgres://ansa@db.example.com/ansa", "postgres:///ansa?host=/tmp", "not a url \x00"} {
		if ReasonNotToRun(config.Config{Environment: "development", DatabaseURL: elsewhere}) == "" {
			t.Fatalf("%q is refused", elsewhere)
		}
	}
	for _, here := range []string{local, "postgresql://a:b@127.0.0.1/x", "postgres://a@[::1]:5432/x"} {
		if reason := ReasonNotToRun(config.Config{Environment: "development", DatabaseURL: here}); reason != "" {
			t.Fatalf("%q is fine: %s", here, reason)
		}
	}
	cfg := config.Config{ListenAddr: "127.0.0.1:8080"}
	if address, err := CoreAddress("", cfg); err != nil || address != "http://127.0.0.1:8080" {
		t.Fatalf("the running core's own address: %q %v", address, err)
	}
	if address, err := CoreAddress("", config.Config{ListenAddr: ":9090"}); err != nil || address != "http://127.0.0.1:9090" {
		t.Fatalf("all interfaces: %q %v", address, err)
	}
	if address, err := CoreAddress("http://localhost:8081/", cfg); err != nil || address != "http://localhost:8081" {
		t.Fatalf("a given local address: %q %v", address, err)
	}
	for _, refused := range []string{"https://core.example.com", "http://10.0.0.5:8080", "ftp://127.0.0.1:21", "http://127.0.0.1:8080/webhooks"} {
		if _, err := CoreAddress(refused, cfg); err == nil {
			t.Fatalf("%q is refused", refused)
		}
	}
}
