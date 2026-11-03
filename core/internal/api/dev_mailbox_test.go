package api

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// writeDevMail writes one email as the stand-in outbox does.
func writeDevMail(t *testing.T, folder, name, to, subject string) {
	t.Helper()
	page := "<div><strong>From:</strong> ansa</div>\n<div><strong>To:</strong> " + to + "</div>\n<div><strong>Subject:</strong> " + subject + "</div>\n<pre>Hello</pre>"
	if err := os.WriteFile(filepath.Join(folder, name), []byte(page), 0o600); err != nil {
		t.Fatal(err)
	}
}

// The development mailbox: owners read the emails sent for their company,
// never another's, nor one an earlier demo reset sent to the same address;
// before a login, the newest email to an address typed; nothing when real
// email is on (no folder).
func TestTheDevelopmentMailboxShowsOnlyTheCompanysEmails(t *testing.T) {
	w := newAPIWorld(t)
	var owner, ownerID string
	w.pool.QueryRow(context.Background(), `SELECT email, id FROM users WHERE company_id = $1`, w.company.String()).Scan(&owner, &ownerID)
	folder := t.TempDir()
	writeDevMail(t, folder, "2026-11-03T09-00-00.000Z-verify-email-OldResetAccountId0000000000000-k1.html", owner, "Confirm your email (an earlier reset)")
	writeDevMail(t, folder, "2026-11-03T10-00-00.000Z-verify-email-"+ownerID+"-k2.html", owner, "Confirm your email")
	writeDevMail(t, folder, "2026-11-03T11-00-00.000Z-ticket-solved-4f1c2d3e-0000-4000-8000-000000000001.html", "stranger@else.example", "Not theirs")
	w.api.DevMailFolder = folder

	code, answer := w.call("GET", "/api/v1/dev/mailbox", "", screensSecret, w.cookie)
	emails, _ := answer["emails"].([]any)
	if code != 200 || answer["available"] != true || len(emails) != 1 || emails[0].(map[string]any)["subject"] != "Confirm your email" {
		t.Fatalf("the company's own emails only: %d %v", code, answer)
	}
	_, newest := w.call("POST", "/api/v1/dev/mailbox/newest", `{"email":"`+owner+`","clientIp":"dev-mailbox-test"}`, screensSecret, "")
	if email, _ := newest["email"].(map[string]any); email == nil || email["subject"] != "Confirm your email" {
		t.Fatalf("the newest email to an address, before a login: %v", newest)
	}
	if _, none := w.call("POST", "/api/v1/dev/mailbox/newest", `{"email":"nobody@else.example","clientIp":"dev-mailbox-test"}`, screensSecret, ""); none["email"] != nil {
		t.Fatalf("no email to that address: %v", none)
	}
	if code, _ := w.call("POST", "/api/v1/dev/mailbox/newest", `{"email":"someone@gmail.com","clientIp":"dev-mailbox-test"}`, screensSecret, ""); code != 403 {
		t.Fatalf("never a real inbox's email without a login: %d", code)
	}
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1`, w.company.String())
	if _, member := w.call("GET", "/api/v1/dev/mailbox", "", screensSecret, w.cookie); member["available"] != false {
		t.Fatal("owners only")
	}
	w.api.DevMailFolder = ""
	if code, _ := w.call("POST", "/api/v1/dev/mailbox/newest", `{"email":"`+owner+`","clientIp":"dev-mailbox-test"}`, screensSecret, ""); code != 403 {
		t.Fatalf("real email on: %d", code)
	}
	t.Cleanup(func() {
		w.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, w.api.Limiter.Key("dev-mailbox", "dev-mailbox-test"))
	})
}
