package api

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSolvingEmailsOnlyTheAddressThePersonSaw(t *testing.T) {
	w := newAPIWorld(t)
	ctx := context.Background()
	var ticketID string
	w.pool.QueryRow(ctx, `INSERT INTO tickets (company_id, ticket_number, subject, description, channel) VALUES ($1, 7, 'Cold pizza', 'x', 'manual') RETURNING id`, w.company.String()).Scan(&ticketID)
	base := "/api/v1/requests/" + ticketID
	code, answer := w.call("POST", base+"/customer-email", `{"email":" Ana@Example.COM ","confirmed":false}`, screensSecret, w.cookie)
	if code != 200 || answer["confirm"] != "ana@example.com" {
		t.Fatalf("the address to confirm: %d %v", code, answer)
	}
	if code, _ := w.call("POST", base+"/customer-email", `{"email":"ana@example.com","confirmed":true}`, screensSecret, w.cookie); code != 200 {
		t.Fatal("saved")
	}
	if code, answer := w.call("POST", base+"/solve", `{"confirmedCustomerEmail":"someone@else.com"}`, screensSecret, w.cookie); code != 409 || !strings.Contains(answer["error"].(string), "changed meanwhile") {
		t.Fatalf("an address the person didn't see: %d %v", code, answer)
	}
	if code, _ := w.call("POST", base+"/solve", `{"confirmedCustomerEmail":"ana@example.com"}`, screensSecret, w.cookie); code != 200 {
		t.Fatal("solved")
	}
	var emailID string
	w.pool.QueryRow(ctx, `SELECT id FROM outgoing_emails WHERE company_id = $1 AND ticket_id = $2`, w.company.String(), ticketID).Scan(&emailID)
	if emailID == "" || w.count(`SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = 'customer_email.deliver'`) != 1 {
		t.Fatal("the email and its delivery are queued with the solve")
	}
	if outcome, err := w.serverAPI().Outbox.Deliver(ctx, w.company, emailID, false); err != nil || outcome != "sent" {
		t.Fatalf("delivered: %s %v", outcome, err)
	}
	files, _ := os.ReadDir(filepath.Join(w.mailbox, ".dev-emails"))
	page, _ := os.ReadFile(filepath.Join(w.mailbox, ".dev-emails", files[0].Name()))
	if len(files) != 1 || !strings.Contains(string(page), "Your request #7 has been solved") || strings.Contains(string(page), "Cold pizza") ||
		!strings.Contains(string(page), "@inbound.ansa.test") {
		t.Fatal("the fixed email: the number, never the subject; replies come back to the forwarding address")
	}
	if code, answer := w.call("POST", base+"/emails/"+emailID+"/retry", `{"confirmPossibleDuplicate":false}`, screensSecret, w.cookie); code != 409 || !strings.Contains(answer["error"].(string), "already sent") {
		t.Fatalf("a Retry after it went: %d %v", code, answer)
	}
	_, page2 := w.call("GET", "/api/v1/requests/7", "", screensSecret, w.cookie)
	if page2["latestEmail"].(map[string]any)["status"] != "sent" {
		t.Fatal("the page shows the email went")
	}
	if code, _ := w.call("POST", base+"/details", `{"subject":"Cold pizza, twice","originalSubject":"Cold pizza","customerName":"","originalCustomerName":""}`, screensSecret, w.cookie); code != 200 {
		t.Fatal("edited")
	}
	if w.count(`SELECT count(*) FROM ticket_activity WHERE company_id = $1 AND kind = 'subject_changed'`) != 1 ||
		w.count(`SELECT count(*) FROM ticket_activity WHERE company_id = $1 AND kind = 'customer_name_changed'`) != 0 {
		t.Fatal("only the changed field is written")
	}
}

func TestANewRequestNeedsItsAddressConfirmed(t *testing.T) {
	w := newAPIWorld(t)
	t.Cleanup(func() {
		w.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, w.serverAPI().Limiter.Key("ticket-creations", w.ownerID()))
	})
	body := `{"subject":"Wants a table for 8","description":"Saturday 20:00","customerName":"Lena","customerEmail":"lena@example.com","customerEmailConfirmed":false,"customerPhone":"","categoryId":""}`
	if code, answer := w.call("POST", "/api/v1/requests", body, screensSecret, w.cookie); code != 400 || answer["fields"].(map[string]any)["customerEmail"] != "Confirm the address before saving" {
		t.Fatalf("not confirmed: %d %v", code, answer)
	}
	code, answer := w.call("POST", "/api/v1/requests", strings.Replace(body, `"customerEmailConfirmed":false`, `"customerEmailConfirmed":true`, 1), screensSecret, w.cookie)
	if code != 200 || answer["number"] != 1.0 {
		t.Fatalf("created: %d %v", code, answer)
	}
	if w.count(`SELECT count(*) FROM ticket_activity WHERE company_id = $1 AND kind = 'created'`) != 1 {
		t.Fatal("its first history row")
	}
}
