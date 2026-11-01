package inbound

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/resend"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

type emailWorld struct {
	t         *testing.T
	pool      *database.Pool
	company   tenant.CompanyID
	folder    string
	processor *Processor
}

func newEmailWorld(t *testing.T) *emailWorld {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	w := &emailWorld{t: t, pool: pool, company: company, folder: t.TempDir()}
	brain := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		io.WriteString(rw, `{"kind":"ok","summary":"Their order is late.","subject":"Late order","category":""}`)
	}))
	t.Cleanup(brain.Close)
	box, _ := secure.NewBox("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	limiter := ratelimit.New(pool, "core-test-secret")
	w.processor = &Processor{Pool: pool, Box: box, Limiter: limiter, Log: logging.New(io.Discard),
		Fetcher: &resend.Fetcher{DevFolder: w.folder}, Brain: brainclient.New(brain.URL, strings.Repeat("s", 40), 5*time.Second),
		EmailFrom: "hello@ansa.example", ForwardingDomain: "inbound.ansa.test"}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, limiter.Key("email-triage", companyID))
	})
	return w
}

// received saves a received email and its stand-in content; returns its row's id.
func (w *emailWorld) received(content string) string {
	resendID, _ := conversations.NewID()
	os.MkdirAll(filepath.Join(w.folder, ".dev-inbound"), 0o700)
	os.WriteFile(filepath.Join(w.folder, ".dev-inbound", resendID+".json"), []byte(content), 0o600)
	var id string
	if err := w.pool.QueryRow(context.Background(), `INSERT INTO inbound_emails (company_id, resend_email_id) VALUES ($1, $2) RETURNING id`, w.company.String(), resendID).Scan(&id); err != nil {
		w.t.Fatalf("setup: %v", err)
	}
	return id
}

func (w *emailWorld) process(id, claim string, filters bool) string {
	outcome, err := w.processor.Process(context.Background(), w.company, id, claim, filters)
	if err != nil {
		w.t.Fatalf("process: %v", err)
	}
	return outcome
}

func TestAVerifiedSenderBecomesTheCustomer(t *testing.T) {
	w := newEmailWorld(t)
	id := w.received(`{"from":"ana@shop-customer.example","headers":{"from":"Ana Smith <ana@shop-customer.example>"},"subject":"Where is my order 4111 1111 1111 1111?",
		"text":"It is late.","authentication":{"spf":"pass","dkim":"pass","dmarc":"pass"}}`)
	if got := w.process(id, claimNew, true); got != Ticketed {
		t.Fatalf("outcome: %s", got)
	}
	var subject, description, email, name, contact string
	w.pool.QueryRow(context.Background(), `SELECT tickets.subject, tickets.description, COALESCE(tickets.customer_email, ''), COALESCE(tickets.customer_name, ''), contacts.external_id
		FROM tickets JOIN conversations ON conversations.id = tickets.conversation_id JOIN contacts ON contacts.id = conversations.contact_id
		WHERE tickets.company_id = $1`, w.company.String()).Scan(&subject, &description, &email, &name, &contact)
	if subject != "Late order" || !strings.HasPrefix(description, "Their order is late.") || email != "ana@shop-customer.example" || name != "Ana Smith" || contact != "ana@shop-customer.example" {
		t.Fatalf("request: %q %q %q %q %q", subject, description, email, name, contact)
	}
}

func TestAForgedSenderIsNeverFilledIn(t *testing.T) {
	w := newEmailWorld(t)
	id := w.received(`{"from":"ceo@bank.example","subject":"Pay this","text":"Now.","authentication":null}`)
	w.process(id, claimNew, true)
	var email, contact string
	w.pool.QueryRow(context.Background(), `SELECT COALESCE(tickets.customer_email, ''), contacts.external_id FROM tickets
		JOIN conversations ON conversations.id = tickets.conversation_id JOIN contacts ON contacts.id = conversations.contact_id
		WHERE tickets.company_id = $1`, w.company.String()).Scan(&email, &contact)
	if email != "" || contact != "unverified:ceo@bank.example" {
		t.Fatalf("not verified: %q %q", email, contact)
	}
}

func TestLoopsAndAutomaticMail(t *testing.T) {
	w := newEmailWorld(t)
	loop := w.received(`{"from":"hello@ansa.example","subject":"x","text":"x"}`)
	if got := w.process(loop, claimNew, true); got != Ignored {
		t.Fatal("ansa's own mail is a loop")
	}
	if got := w.process(loop, ClaimAnyway, false); got != NotClaimed {
		t.Fatal("never a request, not even anyway")
	}
	auto := w.received(`{"from":"ana@x.example","subject":"Out of office","text":"Away","headers":{"Auto-Submitted":"auto-replied"}}`)
	if got := w.process(auto, claimNew, true); got != Ignored {
		t.Fatal("an automatic reply is skipped")
	}
	if got := w.process(auto, ClaimAnyway, false); got != Ticketed {
		t.Fatal("Make a ticket anyway")
	}
	missing := w.received(`{}`)
	os.Remove(filepath.Join(w.folder, ".dev-inbound", "none"))
	w.pool.Exec(context.Background(), `UPDATE inbound_emails SET resend_email_id = 'no-such-file' WHERE company_id = $1 AND id = $2`, w.company.String(), missing)
	if got := w.process(missing, claimNew, true); got != Ignored {
		t.Fatal("content unavailable is recorded")
	}
}

func TestHTMLIsReadAsText(t *testing.T) {
	got := HTMLToText(`<html><head><title>x</title><style>p{}</style></head><body><p>Hello &amp; welcome</p><table><tr><td>Email</td><td>ana@x.com</td></tr></table><script>alert(1)</script></body></html>`, 1000)
	if got != "Hello & welcome\n\nEmail\tana@x.com" {
		t.Fatalf("text: %q", got)
	}
}
