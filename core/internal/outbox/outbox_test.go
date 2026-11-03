package outbox

import (
	"context"
	"html"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/email"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/tenant"
)

// deliveredSolvedEmail solves request #7 of a new company of that kind and
// name, delivers its "solved" email and returns the page the dev outbox wrote.
func deliveredSolvedEmail(t *testing.T, kind, name string) string {
	ctx := context.Background()
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	solver := database.TestOwner(t, pool, companyID)
	limiter := ratelimit.New(pool, "core-test-secret")
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, limiter.Key("customer-emails", companyID))
	})
	if _, err := pool.Exec(ctx, `UPDATE companies SET kind = $2, name = $3 WHERE id = $1`, companyID, kind, name); err != nil {
		t.Fatalf("setup: %v", err)
	}
	var ticketID, emailID string
	err := pool.QueryRow(ctx, `INSERT INTO tickets (company_id, ticket_number, subject, description, channel, customer_name, status, solved_at, solved_by_user_id)
		VALUES ($1, 7, 'Cold pizza', 'x', 'manual', 'Lena Rossi', 'solved', now() - interval '1 minute', $2) RETURNING id`, companyID, solver).Scan(&ticketID)
	if err == nil {
		err = pool.QueryRow(ctx, `INSERT INTO outgoing_emails (company_id, ticket_id, kind, to_email) VALUES ($1, $2, 'ticket_solved', 'ana@example.com') RETURNING id`,
			companyID, ticketID).Scan(&emailID)
	}
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	folder := t.TempDir()
	deliverer := &Deliverer{Pool: pool, Limiter: limiter, Email: &email.Sender{DevFolder: folder}, ForwardingDomain: "inbound.ansa.test"}
	if outcome, err := deliverer.Deliver(ctx, company, emailID, false); err != nil || outcome != Sent {
		t.Fatalf("delivered: %s %v", outcome, err)
	}
	files, _ := os.ReadDir(filepath.Join(folder, ".dev-emails"))
	if len(files) != 1 {
		t.Fatalf("one email: %d", len(files))
	}
	page, _ := os.ReadFile(filepath.Join(folder, ".dev-emails", files[0].Name()))
	if strings.Contains(string(page), "Cold pizza") || strings.Contains(string(page), "Lena") || !strings.Contains(string(page), "Your request #7 has been solved") {
		t.Fatal("the number only: never the subject or the customer's name")
	}
	return string(page)
}

// A business's "solved" email speaks for its team, word for word as before;
// one person's says what they did, signed by their AI assistant (ansa never
// signs as them), with no team and no support desk.
func TestTheSolvedEmailSpeaksForABusinessOrForOnePerson(t *testing.T) {
	business := deliveredSolvedEmail(t, "business", "Pizza & Co")
	businessText := "Hello,\n\nGood news: your request #7 has been solved by the Pizza & Co team.\n\nIf you still need help, just get in touch with us again.\n\nPizza & Co Support"
	businessHTML := `<p>Hello,</p>
    <p>Good news: your request #7 has been solved by the Pizza &amp; Co team.</p>
    <p>If you still need help, just get in touch with us again.</p>
    <p>Pizza &amp; Co Support</p>`
	if !strings.Contains(business, "<pre>"+html.EscapeString(businessText)+"</pre>") || !strings.Contains(business, businessHTML) {
		t.Fatalf("a business's email changed:\n%s", business)
	}
	person := deliveredSolvedEmail(t, "personal", "Rafa")
	personText := "Hello,\n\nRafa has taken care of your request #7.\n\nIf you still need help, just get in touch with Rafa again.\n\nRafa's AI assistant"
	personHTML := `<p>Hello,</p>
    <p>Rafa has taken care of your request #7.</p>
    <p>If you still need help, just get in touch with Rafa again.</p>
    <p>Rafa&#39;s AI assistant</p>`
	if !strings.Contains(person, "<pre>"+html.EscapeString(personText)+"</pre>") || !strings.Contains(person, personHTML) {
		t.Fatalf("a person's email:\n%s", person)
	}
	if strings.Contains(person, "team") || strings.Contains(person, "Support") {
		t.Fatal("one person has no team and no support desk")
	}
}
