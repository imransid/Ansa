package assistant

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

func TestTheBrainGetsOneCompanysSliceOnly(t *testing.T) {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	owner := database.TestOwner(t, pool, companyID)
	company, _ := tenant.FromTrustedSource(companyID)
	box, _ := secure.NewBox("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	ctx := context.Background()
	hoursJSON := `{"mon":[],"tue":[{"opens":"18:00","closes":"24:00"}],"wed":[],"thu":[],"fri":[],"sat":[],"sun":[]}`
	mustExec(t, pool, `INSERT INTO assistant_settings (company_id, currency, delivery, delivery_fee_cents, time_zone, opening_hours, instructions, updated_by_user_id)
		VALUES ($1, 'EUR', true, 250, 'Europe/Rome', $2::jsonb, 'Lunch menu on weekdays.', $3)`, companyID, hoursJSON, owner)
	mustExec(t, pool, `INSERT INTO catalog_items (company_id, category, name, price_cents, position) VALUES ($1, 'Pizza', 'Margherita', 950, 1)`, companyID)
	mustExec(t, pool, `INSERT INTO catalog_items (company_id, category, name, price_cents, position, unavailable_until) VALUES ($1, 'Pizza', 'Sold out', 800, 2, now() + interval '1 hour')`, companyID)
	messageID := "66666666-6666-4666-8666-666666666666"
	body, _ := box.Encrypt("Are you open tonight?", conversations.MessageContext(company, messageID))
	turn, _ := conversations.InsertCustomerMessage(ctx, pool, company, conversations.ContactKey{Channel: conversations.ChannelStandIn, ExternalID: "in"}, conversations.IncomingMessage{ID: messageID, BodyEncrypted: body, ChannelMessageID: "i1"})

	tuesdayEvening := time.Date(2026, 11, 3, 18, 30, 0, 0, time.UTC)
	inputs, err := GatherInputs(ctx, pool, box, company, turn.ConversationID, tuesdayEvening)
	if err != nil {
		t.Fatalf("GatherInputs: %v", err)
	}
	request := inputs.Request
	if len(request.Menu) != 1 || request.Menu[0].Label != "M1" || request.Menu[0].Price != "€9.50" {
		t.Fatalf("only available dishes, labelled: %+v", request.Menu)
	}
	if request.Orders.DeliveryFee == nil || *request.Orders.DeliveryFee != "€2.50" || !request.Orders.TakesOrders {
		t.Fatalf("orders: %+v", request.Orders)
	}
	if request.Hours == nil || request.Hours.Now != "Tuesday 19:30, open until midnight" {
		t.Fatalf("hours: %+v", request.Hours)
	}
	if len(request.Conversation) != 1 || request.Conversation[0] != (Line{Sender: "customer", Text: "Are you open tonight?"}) {
		t.Fatalf("conversation: %+v", request.Conversation)
	}
	encoded, _ := json.Marshal(request)
	for _, leak := range []string{companyID, turn.ConversationID, messageID, owner} {
		if strings.Contains(string(encoded), leak) {
			t.Fatalf("an id reached the brain's request: %s", leak)
		}
	}
	if !containsInt(inputs.Checks.MenuPrices, 250) {
		t.Fatal("the delivery fee is an amount a reply may name")
	}
}

func mustExec(t *testing.T, pool *database.Pool, statement string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), statement, args...); err != nil {
		t.Fatalf("setup: %v", err)
	}
}

func containsInt(values []int64, want int64) bool {
	for _, v := range values {
		if v == want {
			return true
		}
	}
	return false
}
