package orders

import (
	"strings"
	"testing"
)

var menu = []MenuChoice{{Label: "M1", Name: "Margherita", PriceCents: 950}, {Label: "M2", Name: "Tiramisù", PriceCents: 600}}
var both = Options{Delivery: true, Pickup: true, DeliveryFeeCents: 250, Currency: "EUR"}

func TestAnsaPricesTheOrderFromTodaysMenu(t *testing.T) {
	order, gap := Price(Request{Items: []Item{{" m1 ", 2}, {"M2", 1}, {"M1", 1}}, Fulfilment: "delivery", Address: " Via Roma 1 "}, menu, both)
	if gap != "" || len(order.Lines) != 2 || order.Lines[0].Quantity != 3 || order.Lines[0].LineTotalCents != 2850 {
		t.Fatalf("the same dish twice is one line: %+v %s", order, gap)
	}
	if order.SubtotalCents != 3450 || order.DeliveryFeeCents != 250 || order.TotalCents != 3700 || order.Address != "Via Roma 1" || order.Time != "As soon as possible" {
		t.Fatalf("totals: %+v", order)
	}
	pickup, _ := Price(Request{Items: []Item{{"M2", 1}}, Fulfilment: "pickup", Address: "ignored"}, menu, both)
	if pickup.DeliveryFeeCents != 0 || pickup.TotalCents != 600 || pickup.Address != "" {
		t.Fatalf("no fee or address for pickup: %+v", pickup)
	}
	gaps := map[string]Request{
		GapUnknownItem: {Items: []Item{{"M9", 1}}, Fulfilment: "pickup"},
		GapNoItems:     {Fulfilment: "pickup"},
		GapHow:         {Items: []Item{{"M1", 1}}},
		GapAddress:     {Items: []Item{{"M1", 1}}, Fulfilment: "delivery"},
	}
	for want, request := range gaps {
		if _, gap := Price(request, menu, both); gap != want {
			t.Errorf("%s: got %q", want, gap)
		}
	}
	if _, gap := Price(Request{Items: []Item{{"M1", 51}}, Fulfilment: "pickup"}, menu, both); gap != GapUnknownItem {
		t.Error("more than 50 of one dish goes to a person")
	}
	if _, gap := Price(Request{Items: []Item{{"M1", 1}}, Fulfilment: "delivery", Address: "x"}, menu, Options{Pickup: true, Currency: "EUR"}); gap != GapHow {
		t.Error("delivery where there is none asks how")
	}
}

// The orders' amounts are 32-bit numbers in the database: a line, subtotal
// or total past 2,147,483,647 smallest units goes to a person, as a dish
// ansa can't place does, never into an INSERT that fails and leaves the
// customer without an answer.
func TestAnOrderTooBigForTheDatabaseGoesToAPerson(t *testing.T) {
	dear := []MenuChoice{{Label: "M1", Name: "Gold cake", PriceCents: 100_000_000}, {Label: "M2", Name: "Gold tea", PriceCents: 46_000_000}}
	withFee := Options{Delivery: true, Pickup: true, DeliveryFeeCents: 2_000_000, Currency: "BDT"}
	tooBig := map[string]Request{
		"a line":     {Items: []Item{{"M1", 50}}, Fulfilment: "pickup"},
		"a subtotal": {Items: []Item{{"M1", 21}, {"M2", 2}}, Fulfilment: "pickup"},
		"a total":    {Items: []Item{{"M1", 21}, {"M2", 1}}, Fulfilment: "delivery", Address: "Road 2"},
	}
	for name, request := range tooBig {
		if _, gap := Price(request, dear, withFee); gap != GapUnknownItem {
			t.Errorf("%s past the database's numbers: got %q", name, gap)
		}
	}
	order, gap := Price(Request{Items: []Item{{"M1", 21}, {"M2", 1}}, Fulfilment: "pickup"}, dear, withFee)
	if gap != "" || order.TotalCents != 2_146_000_000 {
		t.Fatalf("just under fits: %+v %q", order, gap)
	}
}

// Orders taken with neither delivery nor pickup (an old setting) go to a
// person: no question may promise a way the business doesn't offer.
func TestNeitherDeliveryNorPickupGoesToAPerson(t *testing.T) {
	neither := Options{Currency: "EUR"}
	step := PlanStep("order_summary", &Request{Items: []Item{{"M1", 1}}, Fulfilment: "pickup"}, Ordering{TakesOrders: true, Menu: menu, Options: neither}, "business")
	if step.Kind != StepHandover || step.Reason != "order" {
		t.Fatalf("a person takes it: %+v", step)
	}
	if got := Question(GapHow, neither, English); strings.Contains(got, "pick") || strings.Contains(got, "deliver") {
		t.Fatalf("no way is promised: %q", got)
	}
	if got := Question(GapHow, Options{Pickup: true}, English); got != "We don't deliver, but you can pick it up. Is pickup all right?" {
		t.Fatalf("pickup only: %q", got)
	}
}

func TestTheSummaryIsAnsasOwnWords(t *testing.T) {
	order, _ := Price(Request{Items: []Item{{"M1", 2}}, Fulfilment: "delivery", Address: "Via Roma 1", Time: "20:00", Notes: "No basil"}, menu, both)
	want := "Here is your order:\n2 × Margherita: €19.00\nDelivery: €2.50\nTotal: €21.50\nDelivery to: Via Roma 1\nWhen: 20:00\nNotes: No basil\n\nShall I place the order? Reply “yes” to confirm."
	if got := SummaryText(order, English); got != want {
		t.Fatalf("summary:\n%s", got)
	}
}

// On a live call ansa's own words are spoken: sentences a voice reads well,
// "say yes", no promise to message the caller later, "tell" not "send".
func TestTheSpokenTextsForACall(t *testing.T) {
	order, _ := Price(Request{Items: []Item{{"M1", 2}}, Fulfilment: "delivery", Address: "Via Roma 1", Time: "20:00", Notes: "No basil"}, menu, both)
	want := "Here is your order: 2 Margherita, 19 euros. Delivery, 2.50 euros. Total, 21.50 euros. Delivered to Via Roma 1. When: 20:00. Notes: No basil. Shall I place the order? Please say yes to confirm."
	if got := SpokenSummaryText(order, English); got != want {
		t.Fatalf("spoken summary:\n%s", got)
	}
	if got := SpokenPlacedText(12, English); got != "Thank you! Your order number 12 is placed." {
		t.Fatalf("placed: %s", got)
	}
	if got := SpokenQuestion(GapAddress, both, English); got != "Where should we deliver it? Please tell me the full address." {
		t.Fatalf("address question: %s", got)
	}
	step := PlanStep("order_summary", &Request{Items: []Item{{"M1", 1}}, Fulfilment: "pickup", Time: "now"}, Ordering{TakesOrders: true, Spoken: true, Menu: menu, Options: both}, "business")
	if step.Kind != StepPropose || !strings.HasPrefix(step.Text, "Here is your order: 1 Margherita") {
		t.Fatalf("a spoken plan proposes in spoken words: %+v", step)
	}
}

func TestThePlan(t *testing.T) {
	open := Ordering{TakesOrders: true, Menu: menu, Options: both}
	request := &Request{Items: []Item{{"M1", 1}}, Fulfilment: "pickup"}
	cases := []struct {
		kind, company string
		ordering      Ordering
		request       *Request
		want          string
	}{
		{"order_summary", "personal", open, request, StepHandover},
		{"order_summary", "business", Ordering{Menu: menu, Options: both}, request, StepHandover},
		{"order_summary", "business", open, request, StepPropose},
		{"order_confirmed", "business", open, nil, StepPlace},
		{"order_withdrawn", "business", open, nil, StepWithdraw},
		{"order_summary", "business", Ordering{TakesOrders: true, ClosedNow: "Opens at 18:00", Menu: menu, Options: both}, request, StepAsk},
		{"order_summary", "business", open, &Request{Items: []Item{{"M1", 1}}}, StepAsk},
	}
	for _, c := range cases {
		if got := PlanStep(c.kind, c.request, c.ordering, c.company); got.Kind != c.want {
			t.Errorf("%s/%s: got %s", c.kind, c.company, got.Kind)
		}
	}
	closed := PlanStep("order_summary", request, Ordering{TakesOrders: true, ClosedNow: "Opens at 18:00", Menu: menu, Options: both}, "business")
	if closed.Text != "Sorry, we can't take orders right now (opens at 18:00)." {
		t.Errorf("closed: %q", closed.Text)
	}
	if !strings.Contains(StatusText("ready", 7, "delivery", false, English), "#7 is on its way") || !strings.Contains(StatusText("cancel", 7, "pickup", true, English), "can't take your order #7") {
		t.Error("status texts")
	}
}
