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
	if len(request.NotAvailableToday) != 1 || request.NotAvailableToday[0] != "Sold out" {
		t.Fatalf("a dish not available today goes by its name only, so the AI never calls it off the menu: %+v", request.NotAvailableToday)
	}
	if encoded, _ := json.Marshal(request); strings.Contains(string(encoded), "€8.00") {
		t.Fatal("a dish not available today has no price to give")
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

// A price the owner wrote in a dish's description is theirs: the AI may
// repeat it. Only today's dishes count (one not available today isn't read).
func TestADishsDescriptionIsTheOwnersOwnWords(t *testing.T) {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	owner := database.TestOwner(t, pool, companyID)
	company, _ := tenant.FromTrustedSource(companyID)
	box, _ := secure.NewBox("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	mustExec(t, pool, `INSERT INTO assistant_settings (company_id, currency, updated_by_user_id) VALUES ($1, 'BDT', $2)`, companyID, owner)
	mustExec(t, pool, `INSERT INTO catalog_items (company_id, name, description, price_cents, position) VALUES ($1, 'Kacchi Biryani', 'With borhani; extra raita BDT 30', 45000, 1)`, companyID)
	mustExec(t, pool, `INSERT INTO catalog_items (company_id, name, description, price_cents, position, unavailable_until) VALUES ($1, 'Firni', 'A second bowl BDT 99', 9000, 2, now() + interval '1 hour')`, companyID)
	inputs, err := GatherInputs(context.Background(), pool, box, company, "", time.Now())
	if err != nil {
		t.Fatalf("GatherInputs: %v", err)
	}
	if got := CheckReply("Yes! Extra raita is BDT 30.", inputs.Checks); got != "" {
		t.Fatalf("a price in today's dish's description: %q", got)
	}
	if got := CheckReply("A second bowl of firni is BDT 99.", inputs.Checks); got != ReasonPriceNotOnMenu {
		t.Fatalf("a dish not available today isn't read: %q", got)
	}
}

// "Take orders" with neither delivery nor pickup (saved before setup refused
// it): the brain hears the business takes no orders here, so it hands the
// customer to a person instead of collecting an order nobody can bring.
func TestNoWayToGetAnOrderMeansNoOrders(t *testing.T) {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	owner := database.TestOwner(t, pool, companyID)
	company, _ := tenant.FromTrustedSource(companyID)
	box, _ := secure.NewBox("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	mustExec(t, pool, `UPDATE companies SET kind = 'business' WHERE id = $1`, companyID)
	mustExec(t, pool, `INSERT INTO assistant_settings (company_id, currency, takes_orders, delivery, pickup, updated_by_user_id) VALUES ($1, 'EUR', true, false, false, $2)`, companyID, owner)
	inputs, err := GatherInputs(context.Background(), pool, box, company, "", time.Now())
	if err != nil {
		t.Fatalf("GatherInputs: %v", err)
	}
	if inputs.Request.Orders.TakesOrders || inputs.Ordering.TakesOrders {
		t.Fatalf("no orders without a way to get them: %+v", inputs.Request.Orders)
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
