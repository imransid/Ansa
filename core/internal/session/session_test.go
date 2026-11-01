package session

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
)

const secret = "better-auth-secret-for-core-tests-0000"

func TestTheCookieIsBetterAuthsSignedValue(t *testing.T) {
	// Made with better-call 1.4.2's own signCookieValue("abc", "secret") in Node.
	if token, ok := VerifySignedValue("abc.mUba1OAOkT%2FIvo5dP34RCkqegy%2BD%2BwnDRShdeGONig4%3D", "secret"); !ok || token != "abc" {
		t.Fatalf("Better Auth's own value: %q %v", token, ok)
	}
	signed := SignValue("token-1", secret)
	if token, ok := VerifySignedValue(signed, secret); !ok || token != "token-1" {
		t.Fatal("a value we sign reads back")
	}
	if _, ok := VerifySignedValue(signed, "another-secret"); ok {
		t.Fatal("another secret's signature is refused")
	}
	if _, ok := VerifySignedValue("token-1", secret); ok {
		t.Fatal("an unsigned value is refused")
	}
}

func TestOnlyALiveSessionOfSomeoneOnTheTeamCounts(t *testing.T) {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	owner := database.TestOwner(t, pool, companyID)
	ctx := context.Background()
	token, _ := conversations.NewID()
	if _, err := pool.Exec(ctx, `INSERT INTO sessions (id, token, expires_at, user_id) VALUES ($1, $1, now() + interval '1 day', $2)`, token, owner); err != nil {
		t.Fatalf("setup: %v", err)
	}
	t.Cleanup(func() { pool.Exec(ctx, `DELETE FROM sessions WHERE token = $1`, token) })
	reader := &Reader{Pool: pool, Secret: secret}
	ask := func(name, value string) *Session {
		r := httptest.NewRequest(http.MethodGet, "/", nil)
		r.AddCookie(&http.Cookie{Name: name, Value: value})
		s, err := reader.FromRequest(ctx, r)
		if err != nil {
			t.Fatalf("FromRequest: %v", err)
		}
		return s
	}
	s := ask("better-auth.session_token", SignValue(token, secret))
	if s == nil || s.UserID != owner || s.CompanyID.String() != companyID || !s.IsOwner() {
		t.Fatalf("the session: %+v", s)
	}
	if ask("__Secure-better-auth.session_token", SignValue(token, secret)) == nil {
		t.Fatal("the https cookie name counts too")
	}
	if ask("better-auth.session_token", strings.Replace(SignValue(token, secret), "%3D", "%3E", 1)) != nil {
		t.Fatal("a changed signature is logged out")
	}
	pool.Exec(ctx, `UPDATE users SET deactivated_at = now() WHERE company_id = $1 AND id = $2`, companyID, owner)
	if ask("better-auth.session_token", SignValue(token, secret)) != nil {
		t.Fatal("someone removed is logged out")
	}
	pool.Exec(ctx, `UPDATE users SET deactivated_at = NULL WHERE company_id = $1 AND id = $2`, companyID, owner)
	pool.Exec(ctx, `UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token = $1`, token)
	if ask("better-auth.session_token", SignValue(token, secret)) != nil {
		t.Fatal("an expired session is logged out")
	}
}
