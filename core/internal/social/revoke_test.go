package social

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"ansa/core/internal/logging"
)

// removedOf disconnects a connection as socialconnect does and returns
// what was taken off it.
func (w *world) removedOf(id, platform, externalID string) Removed {
	var access, refresh *string
	w.pool.QueryRow(context.Background(), `SELECT access_token_encrypted, refresh_token_encrypted FROM social_connections WHERE company_id = $1 AND id = $2`,
		w.company.String(), id).Scan(&access, &refresh)
	w.must(`UPDATE social_connections SET status = 'disconnected', access_token_encrypted = NULL, refresh_token_encrypted = NULL, access_expires_at = NULL,
		refresh_expires_at = NULL, last_error = NULL, renewal_started_at = NULL, disconnected_at = now() WHERE company_id = $1 AND id = $2`, w.company.String(), id)
	removed := Removed{ConnectionID: id, Platform: platform, ExternalID: externalID, IsStandIn: externalID == "dev:stand-in"}
	if access != nil {
		removed.AccessEncrypted = *access
	}
	if refresh != nil {
		removed.RefreshEncrypted = *refresh
	}
	return removed
}

func TestDisconnectRevokesOnlyOnceNoCompanyStillHasTheAccount(t *testing.T) {
	w := newWorld(t)
	other := newWorld(t)
	ctx := context.Background()
	var lines bytes.Buffer
	log := logging.New(&lines)
	x := fake(reply(200, `{"revoked":true}`), reply(200, `{"revoked":true}`))
	connectors := w.renewer(x).Platforms
	ours := w.connect("x", "777", 0, true)
	theirs := other.connect("x", "777", 0, true)
	removed := w.removedOf(ours, "x", "777")
	check(t, "another company still has it", []any{RevokeRemoved(ctx, w.pool, w.box, connectors, log, w.company, removed), x.count()}, []any{"still_connected", 0})
	other.must(`UPDATE social_connections SET status = 'needs_reauth', last_error = 'token_rejected' WHERE company_id = $1 AND id = $2`, other.company.String(), theirs)
	check(t, "waiting for a reconnect counts too", RevokeRemoved(ctx, w.pool, w.box, connectors, log, w.company, removed), "still_connected")
	other.removedOf(theirs, "x", "777")
	check(t, "the last company to disconnect it has it revoked", RevokeRemoved(ctx, w.pool, w.box, connectors, log, w.company, removed), "revoked")
	received := strings.Join(*x.received, "\n")
	if !strings.Contains((*x.received)[0], "token=x-refresh") || !strings.Contains((*x.received)[1], "token=x-access") || !strings.Contains(received, "/2/oauth2/revoke") {
		t.Fatalf("the refresh token first, then the access token: %v", received)
	}
	failing := fake(reply(503, "no x-access here"))
	again := w.removedOf(w.connect("x", "888", 0, true), "x", "888")
	check(t, "a failed revoke", RevokeRemoved(ctx, w.pool, w.box, w.renewer(failing).Platforms, log, w.company, again), "status_503")
	if !strings.Contains(lines.String(), `"msg":"social: revoke failed","code":"status_503"`) || strings.Contains(lines.String(), "x-access") || strings.Contains(lines.String(), "x-refresh") {
		t.Fatalf("one fixed line, never a token: %s", lines.String())
	}
	nobody := fake()
	for _, removed := range []Removed{w.removedOf(w.connect("linkedin", "abc", 0, false), "linkedin", "abc"), w.removedOf(w.connect("x", "dev:stand-in", 0, false), "x", "dev:stand-in")} {
		check(t, "LinkedIn and the stand-in offer no revoke", RevokeRemoved(ctx, w.pool, w.box, w.renewer(nobody).Platforms, log, w.company, removed), "not_offered")
	}
	check(t, "nobody asked", nobody.count(), 0)
}

// Only core/internal/social decrypts a token: anywhere else a token's
// context may only encrypt (saving what a platform gave), and nothing
// builds one by hand.
func TestOnlyThisPackageDecryptsTokens(t *testing.T) {
	encrypting := regexp.MustCompile(`\.Encrypt\([^\n]*TokenContext\(`)
	err := filepath.Walk("..", func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || filepath.Ext(path) != ".go" || strings.HasSuffix(path, "_test.go") || filepath.Dir(path) == filepath.Join("..", "social") {
			return err
		}
		source, readErr := os.ReadFile(path)
		for number, line := range strings.Split(string(source), "\n") {
			if strings.Contains(line, "TokenContext(") && !encrypting.MatchString(line) {
				t.Errorf("%s:%d: a token's context outside core/internal/social, not to encrypt", path, number+1)
			}
			if strings.Contains(line, "-token:") {
				t.Errorf("%s:%d: a token's context written by hand", path, number+1)
			}
		}
		return readErr
	})
	if err != nil {
		t.Fatalf("reading core: %v", err)
	}
}

// The tenant check lets the cross-company read through only by its marker,
// and CROSS_COMPANY.md lists it.
func TestTheCrossCompanyReadIsListed(t *testing.T) {
	listed, err := os.ReadFile(filepath.Join("..", "database", "CROSS_COMPANY.md"))
	if err != nil || !strings.Contains(string(listed), "internal/social/revoke.go") {
		t.Fatal("CROSS_COMPANY.md lists the revoke's yes-or-no read")
	}
}
