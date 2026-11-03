package alerts

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ansa/core/internal/assistant"
	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/email"
	"ansa/core/internal/jobs"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/tenant"
)

func TestOwnersAreToldWhoWhereAndWhyNeverTheMessages(t *testing.T) {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	ctx := context.Background()
	database.TestOwner(t, pool, companyID)
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, company_id, role, name, email, email_verified) VALUES (gen_random_uuid()::text, $1, 'owner', 'Unconfirmed', gen_random_uuid()::text || '@core-test.example', false)`, companyID); err != nil {
		t.Fatalf("setup: %v", err)
	}
	name := "Ana\nBaker"
	messageID, _ := conversations.NewID()
	turn, err := conversations.InsertCustomerMessage(ctx, pool, company, conversations.ContactKey{Channel: conversations.ChannelStandIn, ExternalID: "alert", DisplayName: &name},
		conversations.IncomingMessage{ID: messageID, BodyEncrypted: "v1:secret:secret:secret", ChannelMessageID: "a1"})
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	folder := t.TempDir()
	limiter := ratelimit.New(pool, "core-test-secret")
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM rate_limits WHERE key = $1`, limiter.Key("owner-alerts", companyID))
	})
	alerter := &Alerter{Pool: pool, Limiter: limiter, Email: &email.Sender{DevFolder: folder}, AppURL: "http://localhost:3000", Log: logging.New(io.Discard)}
	payload, _ := json.Marshal(assistant.AlertPayload{ConversationID: turn.ConversationID, Reason: "complaint"})
	job := &jobs.Job{ID: "11111111-1111-4111-8111-111111111111", CompanyID: company, Kind: assistant.AlertJobKind, Payload: payload}
	if err := alerter.HandleJob(ctx, job); err != nil {
		t.Fatalf("HandleJob: %v", err)
	}
	files, _ := os.ReadDir(filepath.Join(folder, ".dev-emails"))
	if len(files) != 1 {
		t.Fatalf("one email, to the confirmed owner only: %d", len(files))
	}
	page, _ := os.ReadFile(filepath.Join(folder, ".dev-emails", files[0].Name()))
	text := string(page)
	for _, want := range []string{"Ana Baker needs you on Stand-in chat. They complained.", "No reply reached them.", "/inbox/" + turn.ConversationID, "core test company via ansa"} {
		if !strings.Contains(text, want) {
			t.Fatalf("the email lacks %q", want)
		}
	}
	if strings.Contains(text, "secret") {
		t.Fatal("the customer's message never goes into an alert")
	}
	if _, err := pool.Exec(ctx, `INSERT INTO assistant_settings (company_id, alert_by_email) VALUES ($1, false)`, companyID); err != nil {
		t.Fatalf("setup: %v", err)
	}
	alerter.HandleJob(ctx, job)
	if files, _ := os.ReadDir(filepath.Join(folder, ".dev-emails")); len(files) != 1 {
		t.Fatal("no email while 'alert by email' is off")
	}
}

func TestANewOrderAlertNamesTheNumberAndTotalOnly(t *testing.T) {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	ctx := context.Background()
	database.TestOwner(t, pool, companyID)
	messageID, _ := conversations.NewID()
	turn, _ := conversations.InsertCustomerMessage(ctx, pool, company, conversations.ContactKey{Channel: conversations.ChannelTelegram, ExternalID: "o1"},
		conversations.IncomingMessage{ID: messageID, BodyEncrypted: "v1:x:y:z", ChannelMessageID: "o1"})
	var orderID string
	err := pool.QueryRow(ctx, `INSERT INTO orders (company_id, conversation_id, status, fulfilment, address_encrypted, wanted_time, currency, subtotal_cents, delivery_fee_cents, total_cents, order_number, placed_at)
		VALUES ($1, $2, 'new', 'delivery', 'v1:secret:secret:secret', 'As soon as possible', 'EUR', 1900, 250, 2150, 7, now()) RETURNING id`, companyID, turn.ConversationID).Scan(&orderID)
	if err != nil {
		t.Fatalf("setup: %v", err)
	}
	folder := t.TempDir()
	limiter := ratelimit.New(pool, "core-test-secret")
	t.Cleanup(func() {
		pool.Exec(ctx, `DELETE FROM rate_limits WHERE key = $1`, limiter.Key("owner-alerts", companyID))
	})
	alerter := &Alerter{Pool: pool, Limiter: limiter, Email: &email.Sender{DevFolder: folder}, AppURL: "http://localhost:3000", Log: logging.New(io.Discard)}
	payload, _ := json.Marshal(assistant.OrderAlertPayload{OrderID: orderID})
	if err := alerter.HandleOrderJob(ctx, &jobs.Job{ID: "x", CompanyID: company, Payload: payload}); err != nil {
		t.Fatalf("HandleOrderJob: %v", err)
	}
	files, _ := os.ReadDir(filepath.Join(folder, ".dev-emails"))
	if len(files) != 1 {
		t.Fatalf("%d emails", len(files))
	}
	page, _ := os.ReadFile(filepath.Join(folder, ".dev-emails", files[0].Name()))
	if !strings.Contains(string(page), "A customer placed order #7 on Telegram: €21.50.") || !strings.Contains(string(page), "/orders") || strings.Contains(string(page), "secret") {
		t.Fatal("number, who, where and the total; never the address")
	}
}

// An important person who writes again while their request is open: the
// alert says so, and that no second holding reply went.
func TestAnImportantPersonWritingAgainIsSaidSo(t *testing.T) {
	name := "Dad"
	alert := NeedsYou{CustomerName: &name, ChannelLabel: "Telegram", Reason: "important_person", WroteAgain: true, Link: "http://localhost:3000/inbox/x"}
	rendered := alert.Email("Rafa")
	if rendered.Subject != "Dad wrote again on Telegram" {
		t.Fatalf("subject: %q", rendered.Subject)
	}
	if !strings.Contains(rendered.Text, "They're one of your important people.") || !strings.Contains(rendered.Text, "They wrote again while their request is still open, so ansa didn't reply again.") {
		t.Fatalf("text: %q", rendered.Text)
	}
	if note := alert.TelegramNote(); !strings.Contains(note, "They wrote again.") {
		t.Fatalf("note: %q", note)
	}
}
