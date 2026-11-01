package api

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"testing"

	"ansa/core/internal/accounts"
	"ansa/core/internal/conversations"
	"ansa/core/internal/email"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
)

var confirmLink = regexp.MustCompile(`verify-email#([A-Za-z0-9_.-]+)`)

func TestSignupConfirmAndLogoutThroughCoresAPI(t *testing.T) {
	w := newAPIWorld(t)
	outbox := t.TempDir()
	limiter := ratelimit.New(w.pool, "api-auth-test-secret-of-32-characters")
	w.api.Accounts = &accounts.Service{Pool: w.pool, Secret: authSecret, AppURL: "http://localhost:3000",
		Mail: &email.Sender{DevFolder: outbox}, Limits: limiter, Log: logging.New(io.Discard)}
	id, _ := conversations.NewID()
	address := id[:8] + "@api-auth-test.example"
	ip := "test-" + id
	t.Cleanup(func() {
		ctx := context.Background()
		var companyID string
		w.pool.QueryRow(ctx, `SELECT company_id FROM users WHERE email = $1`, address).Scan(&companyID)
		w.pool.Exec(ctx, `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = $1)`, address)
		w.pool.Exec(ctx, `DELETE FROM accounts WHERE user_id IN (SELECT id FROM users WHERE email = $1)`, address)
		w.pool.Exec(ctx, `DELETE FROM users WHERE email = $1`, address)
		w.pool.Exec(ctx, `DELETE FROM companies WHERE id::text = $1 AND name = 'New business'`, companyID)
		for _, key := range []string{limiter.Key("signup", ip), limiter.Key("verification-email", address), limiter.Key("verify-email", ip),
			limiter.Key("login-ip", ip), limiter.Key("login-email-ip", address+" "+ip), limiter.Key("login-email", address)} {
			w.pool.Exec(ctx, `DELETE FROM rate_limits WHERE key = $1`, key)
		}
	})
	if code, answer := w.call("POST", "/api/v1/auth/signup", `{"name":"An\na","email":"x","password":"short","clientIp":"`+ip+`"}`, screensSecret, ""); code != 400 || len(answer["fields"].(map[string]any)) != 3 {
		t.Fatalf("problems: %d %v", code, answer)
	}
	if code, _ := w.call("POST", "/api/v1/auth/signup", `{"name":"Ana","email":"`+address+`","password":"a long password here","clientIp":"`+ip+`"}`, "another-secret", ""); code != 403 {
		t.Fatal("only the screens may call it")
	}
	if code, answer := w.call("POST", "/api/v1/auth/signup", `{"name":"Ana","email":"`+address+`","password":"a long password here","clientIp":"`+ip+`"}`, screensSecret, ""); code != 200 || answer["outcome"] != "check-your-email" {
		t.Fatalf("signup: %d %v", code, answer)
	}
	files, _ := filepath.Glob(filepath.Join(outbox, ".dev-emails", "*.html"))
	if len(files) != 1 {
		t.Fatalf("one confirmation email: %v", files)
	}
	page, _ := os.ReadFile(files[0])
	token := confirmLink.FindStringSubmatch(string(page))[1]
	code, answer := w.call("POST", "/api/v1/auth/confirm", `{"token":"`+token+`","password":"a long password here","clientIp":"`+ip+`"}`, screensSecret, "")
	cookies, _ := answer["cookies"].([]any)
	if code != 200 || len(cookies) != 2 {
		t.Fatalf("confirm: %d %v", code, answer)
	}
	session := cookies[0].(map[string]any)
	cookie := session["name"].(string) + "=" + session["value"].(string)
	_, account := w.call("GET", "/api/v1/account", "", screensSecret, cookie)
	if account["email"] != address || account["activeSessions"] != 1.0 {
		t.Fatalf("logged in as the new owner: %v", account)
	}
	if code, answer := w.call("POST", "/api/v1/auth/logout", "", screensSecret, cookie); code != 200 || answer["cookies"].([]any)[0].(map[string]any)["maxAge"] != -1.0 {
		t.Fatalf("logout: %d %v", code, answer)
	}
	if code, _ := w.call("GET", "/api/v1/account", "", screensSecret, cookie); code != 401 {
		t.Fatalf("that login ended: %d", code)
	}
	if code, answer := w.call("POST", "/api/v1/auth/logout", "", screensSecret, cookie); code != 200 || answer["cookies"] == nil {
		t.Fatalf("an ended login still gets the clearing cookie: %d %v", code, answer)
	}
}
