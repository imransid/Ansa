package api

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/inbound"
	"ansa/core/internal/jobs"
	"ansa/core/internal/logging"
	"ansa/core/internal/resend"
)

// The practice email (development only): an owner writes an email as a
// made-up customer. Its content waits where core's development fetcher
// reads received emails, addressed to the company's forwarding address, and
// the email is saved with its processing queued for this company only, as
// Resend's webhook saves one. Owners only; refused in production and while
// real email is on; every field checked, an unknown one refused.
func TestThePracticeEmailIsSavedAsResendsWebhookSavesOne(t *testing.T) {
	w := newAPIWorld(t)
	ctx := context.Background()
	w.api.Inbound = &inbound.Processor{Fetcher: &resend.Fetcher{DevFolder: t.TempDir()}}
	forgetPracticeEmailLimits(t, w)
	if _, page := w.call("GET", "/api/v1/practice/chat", "", screensSecret, w.cookie); page["email"] != true {
		t.Fatalf("the page offers the email: %v", page)
	}
	lena := `{"name":"Lena Rossi","address":" Lena@Example.COM ","subject":"A table for six on Friday?","text":"Hello,\n\nDo you have a table for six?","verified":true}`
	code, answer := w.call("POST", "/api/v1/practice/email", lena, screensSecret, w.cookie)
	var token string
	w.pool.QueryRow(ctx, `SELECT inbound_token FROM companies WHERE id = $1`, w.company.String()).Scan(&token)
	if code != 200 || answer["to"] != "c-"+token+"@inbound.ansa.test" {
		t.Fatalf("sent to the company's forwarding address: %d %v", code, answer)
	}
	var emailID, resendID string
	if err := w.pool.QueryRow(ctx, `SELECT id, resend_email_id FROM inbound_emails WHERE company_id = $1 AND status = 'received'`,
		w.company.String()).Scan(&emailID, &resendID); err != nil {
		t.Fatalf("the email saved for this company, as received: %v", err)
	}
	var ours, anywhere int
	w.pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE company_id = $1), count(*) FROM core_jobs WHERE kind = 'inbound_email.process' AND payload->>'inboundEmailId' = $2`,
		w.company.String(), emailID).Scan(&ours, &anywhere)
	if ours != 1 || anywhere != 1 {
		t.Fatalf("its processing queued for this company only: %d of %d", ours, anywhere)
	}
	content, _ := w.api.Inbound.Fetcher.Fetch(ctx, resendID)
	if content == nil || content.From != "lena@example.com" || content.Subject != "A table for six on Friday?" || content.Text == nil ||
		*content.Text != "Hello,\n\nDo you have a table for six?" || !inbound.ReadSender(content, nil, "hello@ansa.example", "inbound.ansa.test").Verified {
		t.Fatalf("the content waits where the development fetcher reads it: %+v", content)
	}

	wrongFields := map[string]int{
		`{"name":"","address":"lena@localhost","subject":"","text":"  ","verified":true}`:                                           3,
		`{"name":"Lena","address":"lena@example.com","subject":"Hi","text":"` + strings.Repeat("a", 100_001) + `","verified":true}`: 1,
	}
	for body, wrong := range wrongFields {
		code, answer := w.call("POST", "/api/v1/practice/email", body, screensSecret, w.cookie)
		if problems, _ := answer["fields"].(map[string]any); code != 400 || len(problems) != wrong {
			t.Fatalf("checked fields: %d %v", code, answer)
		}
	}
	if code, _ := w.call("POST", "/api/v1/practice/email", strings.Replace(lena, `"verified"`, `"companyId":"x","verified"`, 1), screensSecret, w.cookie); code != 400 {
		t.Fatalf("an unknown field: %d", code)
	}
	w.api.Inbound.Fetcher.Real = true
	if _, page := w.call("GET", "/api/v1/practice/chat", "", screensSecret, w.cookie); page["email"] != false {
		t.Fatal("real email on: core would ask Resend for it")
	}
	if code, _ := w.call("POST", "/api/v1/practice/email", lena, screensSecret, w.cookie); code != 409 {
		t.Fatalf("real email on: %d", code)
	}
	w.api.Inbound.Fetcher.Real = false
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1`, w.company.String())
	if code, _ := w.call("POST", "/api/v1/practice/email", lena, screensSecret, w.cookie); code != 403 {
		t.Fatalf("members: %d", code)
	}
	w.must(`UPDATE users SET role = 'owner' WHERE company_id = $1`, w.company.String())
	w.api.Development = false
	if code, _ := w.call("POST", "/api/v1/practice/email", lena, screensSecret, w.cookie); code != 403 {
		t.Fatalf("production: %d", code)
	}
	if w.count(`SELECT count(*) FROM inbound_emails WHERE company_id = $1`) != 1 {
		t.Fatal("nothing refused was saved")
	}
}

// A practice email becomes a request as a forwarded email does, once core's
// worker runs its job: a verified sender is the request's customer and joins
// their conversation; an unverified one is only suggested, in a
// conversation of its own.
func TestAPracticeEmailBecomesARequestLikeAForwardedOne(t *testing.T) {
	w := newAPIWorld(t)
	brain := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		io.WriteString(rw, `{"kind":"ok","summary":"They ask for a table.","subject":"A table on Friday","category":""}`)
	}))
	t.Cleanup(brain.Close)
	processor := &inbound.Processor{Pool: w.pool, Box: w.api.Box, Limiter: w.api.Limiter, Log: logging.New(io.Discard),
		Fetcher: &resend.Fetcher{DevFolder: t.TempDir()}, Brain: brainclient.New(brain.URL, strings.Repeat("s", 40), 5*time.Second),
		EmailFrom: "hello@ansa.example", ForwardingDomain: "inbound.ansa.test"}
	w.api.Inbound = processor
	forgetPracticeEmailLimits(t, w, "lena@example.com", "marco@example.com")
	for _, email := range []string{
		`{"name":"Lena \"La\" Rossi","address":"lena@example.com","subject":"Friday","text":"A table for six?","verified":true}`,
		`{"name":"","address":"marco@example.com","subject":"Friday","text":"A table for two?","verified":false}`,
	} {
		if code, answer := w.call("POST", "/api/v1/practice/email", email, screensSecret, w.cookie); code != 200 {
			t.Fatalf("sent: %d %v", code, answer)
		}
	}
	worker := jobs.NewWorker(w.pool, logging.New(io.Discard))
	worker.OnlyCompany = w.company.String()
	worker.Handle(resend.ProcessJobKind, processor.HandleJob)
	for {
		ran, err := worker.RunOnce(context.Background())
		if err != nil {
			t.Fatalf("core's worker: %v", err)
		}
		if !ran {
			break
		}
	}
	if w.count(`SELECT count(*) FROM inbound_emails WHERE company_id = $1 AND status = 'ticketed'`) != 2 {
		t.Fatal("both emails became requests")
	}
	requestOf := func(sender string) (customerEmail, customerName, contact string) {
		w.pool.QueryRow(context.Background(), `SELECT COALESCE(tickets.customer_email, ''), COALESCE(tickets.customer_name, ''), contacts.external_id
			FROM inbound_emails JOIN tickets ON tickets.id = inbound_emails.ticket_id AND tickets.company_id = inbound_emails.company_id
			JOIN conversations ON conversations.id = tickets.conversation_id JOIN contacts ON contacts.id = conversations.contact_id
			WHERE inbound_emails.company_id = $1 AND inbound_emails.from_address = $2`, w.company.String(), sender).Scan(&customerEmail, &customerName, &contact)
		return customerEmail, customerName, contact
	}
	if email, name, contact := requestOf("lena@example.com"); email != "lena@example.com" || name != `Lena "La" Rossi` || contact != "lena@example.com" {
		t.Fatalf("a verified sender is the customer: %q %q %q", email, name, contact)
	}
	if email, _, contact := requestOf("marco@example.com"); email != "" || contact != "unverified:marco@example.com" {
		t.Fatalf("an unverified sender is only suggested: %q %q", email, contact)
	}
}

// forgetPracticeEmailLimits deletes, after the test, the counters practice
// emails count on (and, for the senders given, their processing).
func forgetPracticeEmailLimits(t *testing.T, w *apiWorld, senders ...string) {
	keys := []string{w.api.Limiter.Key("practice-emails", w.company.String()), w.api.Limiter.Key("email-triage", w.company.String())}
	for _, sender := range senders {
		keys = append(keys, w.api.Limiter.Key("inbound-email", w.company.String()+":"+sender))
	}
	t.Cleanup(func() { w.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = ANY($1)`, keys) })
}
