package main

import (
	"context"
	"encoding/base64"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/resend"
	"ansa/core/internal/tickets"
)

// runningEmailCore serves core's real Resend webhook on the test database at
// a local address, with the same RESEND_WEBHOOK_SECRET as the tool reads.
func (w *testWorld) runningEmailCore() string {
	secret := "whsec_" + base64.StdEncoding.EncodeToString([]byte(strings.Repeat("r", 32)))
	w.settings["RESEND_WEBHOOK_SECRET"] = secret
	hook := &resend.Webhook{Pool: w.pool, Limiter: ratelimit.New(w.pool, w.settings["BETTER_AUTH_SECRET"]), Log: logging.New(io.Discard),
		Secret: secret, ForwardingDomain: "inbound.ansa.test"}
	server := httptest.NewServer(hook)
	w.t.Cleanup(server.Close)
	w.forgetRateLimits([2]string{"resend-webhook", "127.0.0.1"})
	return server.URL
}

// The email's content waits in .dev-inbound/ (core's stand-in for Resend),
// the signed event reaches core's real webhook, and only the forwarding
// address decides the company.
func TestInboundEmailReachesTheRunningCoreThroughTheForwardingAddress(t *testing.T) {
	w := newTestWorld(t)
	if _, err := w.run("inbound-email", w.owner); err == nil || !strings.Contains(err.Error(), "RESEND_WEBHOOK_SECRET") {
		t.Fatalf("without the secret: %v", err)
	}
	address := w.runningEmailCore()
	received := `SELECT count(*) FROM inbound_emails WHERE company_id = $1`
	checkable := w.settings["RESEND_WEBHOOK_SECRET"]
	w.settings["RESEND_WEBHOOK_SECRET"] = "whsec_not-base64!"
	if _, err := w.run("inbound-email", w.owner, "--core", address); err == nil || !strings.Contains(err.Error(), "RESEND_WEBHOOK_SECRET") || w.count(received) != 0 {
		t.Fatalf("a secret core can't check events with is refused before sending: %v", err)
	}
	w.settings["RESEND_WEBHOOK_SECRET"] = checkable
	out, err := w.run("inbound-email", w.owner, "--core", address)
	if err != nil || !strings.Contains(out, "valid: got 200 (expected 200). Sent to c-") || w.count(received) != 1 {
		t.Fatalf("valid: %q %v", out, err)
	}
	files, _ := os.ReadDir(filepath.Join(w.settings["ANSA_DEV_FOLDER"], ".dev-inbound"))
	if len(files) != 1 {
		t.Fatalf("the content waits in .dev-inbound/: %d files", len(files))
	}
	var token string
	w.pool.QueryRow(context.Background(), `SELECT inbound_token FROM companies WHERE id = $1`, w.company.String()).Scan(&token)
	if _, err := w.run("inbound-email", "c-"+token+"@inbound.ansa.test", "html-only", "--core", address); err != nil || w.count(received) != 2 {
		t.Fatalf("by the forwarding address itself: %v", err)
	}
	for _, ignored := range []string{"typed-only", "unsigned"} {
		if out, err := w.run("inbound-email", w.owner, ignored, "--core", address); err != nil || w.count(received) != 2 {
			t.Fatalf("%s saves nothing: %q %v", ignored, out, err)
		}
	}
	if _, err := w.run("inbound-email", w.owner, "loud", "--core", address); err == nil || !strings.Contains(err.Error(), "Unknown variant") {
		t.Fatalf("an unknown variant: %v", err)
	}
	for name, value := range map[string]string{"SEND_REAL_EMAIL": "true", "EMAIL_FROM": "ansa@example.com", "RESEND_API_KEY": "re_x", "INBOUND_EMAIL_DOMAIN": "inbound.example.com"} {
		w.settings[name] = value
	}
	if _, err := w.run("inbound-email", w.owner, "--core", address); err == nil || !strings.Contains(err.Error(), "SEND_REAL_EMAIL") {
		t.Fatalf("with real email on: %v", err)
	}
}

// A delivery problem for an email in .dev-emails/ reaches core's real
// webhook and is recorded on that sent email.
func TestEmailBounceMarksTheSentEmail(t *testing.T) {
	w := newTestWorld(t)
	address := w.runningEmailCore()
	ctx := context.Background()
	os.MkdirAll(filepath.Join(w.settings["ANSA_DEV_FOLDER"], ".dev-emails"), 0o700)
	for _, notAnEmail := range []string{"missing.html", "..", "."} {
		if _, err := w.run("email-bounce", notAnEmail, "--core", address); err == nil || !strings.Contains(err.Error(), "no such file") {
			t.Fatalf("%q isn't an email in .dev-emails/: %v", notAnEmail, err)
		}
	}
	number, err := tickets.CreateManual(ctx, w.pool, w.company, w.ownerID, tickets.NewRequest{Subject: "Late order", Description: "Where is it?"})
	if err != nil {
		t.Fatal(err)
	}
	var ticketID string
	w.pool.QueryRow(ctx, `SELECT id FROM tickets WHERE company_id = $1 AND ticket_number = $2`, w.company.String(), number).Scan(&ticketID)
	name := "2026-11-01T10-00-00.000Z-" + randomHex(4) + ".html"
	os.WriteFile(filepath.Join(w.settings["ANSA_DEV_FOLDER"], ".dev-emails", name), []byte("<p>solved</p>"), 0o600)
	_, err = w.pool.Exec(ctx, `INSERT INTO outgoing_emails (company_id, ticket_id, kind, to_email, status, provider_message_id, sent_at)
		VALUES ($1, $2, 'ticket_solved', 'customer@example.com', 'sent', $3, now())`, w.company.String(), ticketID, "dev-outbox:"+name)
	if err != nil {
		t.Fatal(err)
	}
	if out, err := w.run("email-bounce", name, "complained", "--core", address); err != nil || !strings.Contains(out, "complained: got 200") {
		t.Fatalf("sent: %q %v", out, err)
	}
	if w.count(`SELECT count(*) FROM outgoing_emails WHERE company_id = $1 AND delivery_problem = 'complained'`) != 1 {
		t.Fatal("the problem is on the sent email")
	}
}
