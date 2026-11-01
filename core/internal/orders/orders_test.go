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

func TestTheSummaryIsAnsasOwnWords(t *testing.T) {
	order, _ := Price(Request{Items: []Item{{"M1", 2}}, Fulfilment: "delivery", Address: "Via Roma 1", Time: "20:00", Notes: "No basil"}, menu, both)
	want := "Here is your order:\n2 × Margherita: €19.00\nDelivery: €2.50\nTotal: €21.50\nDelivery to: Via Roma 1\nWhen: 20:00\nNotes: No basil\n\nShall I place the order? Reply “yes” to confirm."
	if got := SummaryText(order); got != want {
		t.Fatalf("summary:\n%s", got)
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
	if !strings.Contains(StatusText("ready", 7, "delivery", false), "#7 is on its way") || !strings.Contains(StatusText("cancel", 7, "pickup", true), "can't take your order #7") {
		t.Error("status texts")
	}
}
