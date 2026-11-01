package assistant

import (
	"context"
	"strings"
	"testing"

	"ansa/core/internal/database"
)

func TestAnOrderIsWrittenUpPlacedAndAlertedByAnsa(t *testing.T) {
	w := newReplyWorld(t, `{"kind":"order_summary","order":{"items":[{"label":"M1","quantity":2}],"fulfilment":"delivery","address":"Via Roma 1","time":"","notes":""}}`)
	owner := database.TestOwner(t, w.pool, w.companyID)
	mustExec(t, w.pool, `INSERT INTO assistant_settings (company_id, delivery, delivery_fee_cents, updated_by_user_id) VALUES ($1, true, 250, $2)`, w.companyID, owner)
	order := w.customerSays("lo", "Two Margherita to Via Roma 1 please")
	if got := w.answer(order); got != OutcomeReplied {
		t.Fatalf("summary: %s", got)
	}
	messages := w.assistantMessages(order)
	if len(messages) != 1 || !strings.Contains(messages[0][1], "2 × Margherita: €19.00\nDelivery: €2.50\nTotal: €21.50") {
		t.Fatalf("ansa's own summary, priced by ansa: %+v", messages)
	}
	var address string
	w.pool.QueryRow(context.Background(), `SELECT address_encrypted FROM orders WHERE company_id = $1 AND status = 'proposed'`, w.companyID).Scan(&address)
	if address == "" || strings.Contains(address, "Via Roma") {
		t.Fatal("the proposal is saved with its address encrypted")
	}

	w.brainAnswer = `{"kind":"order_confirmed"}`
	yes := w.customerSays("lo", "yes")
	if got := w.answer(yes); got != OutcomeReplied {
		t.Fatalf("placing: %s", got)
	}
	if w.count(`SELECT count(*) FROM orders WHERE company_id = $1 AND status = 'new' AND order_number = 1 AND total_cents = 2150`, w.companyID) != 1 {
		t.Fatal("placed as #1 with ansa's total")
	}
	last := w.assistantMessages(yes)
	if last[len(last)-1][1] != "Thank you! Your order #1 is placed. We'll message you as soon as it's accepted." {
		t.Fatalf("confirmation: %q", last[len(last)-1][1])
	}
	if w.count(`SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = 'order.alert'`, w.companyID) != 1 ||
		w.count(`SELECT count(*) FROM assistant_activity WHERE company_id = $1 AND action = 'order_placed'`, w.companyID) != 1 {
		t.Fatal("the owners' alert is queued and the line written")
	}
	if !strings.Contains(strings.Join(w.sent[len(w.sent)-1].Orders.InProgress, " "), "2 × Margherita (M1)") {
		t.Fatal("the brain saw the order being written up")
	}

	again := w.customerSays("lo", "yes!")
	if got := w.answer(again); got != OutcomeHandedOver {
		t.Fatalf("a yes with nothing to say yes to goes to a person: %s", got)
	}
}

func TestANoTakesTheOrderBack(t *testing.T) {
	w := newReplyWorld(t, `{"kind":"order_summary","order":{"items":[{"label":"M1","quantity":1}],"fulfilment":"pickup","address":"","time":"19:00","notes":""}}`)
	first := w.customerSays("mo", "One Margherita to pick up at 19:00")
	w.answer(first)
	w.brainAnswer = `{"kind":"order_withdrawn"}`
	no := w.customerSays("mo", "Actually no")
	if got := w.answer(no); got != OutcomeReplied {
		t.Fatalf("withdraw: %s", got)
	}
	if w.count(`SELECT count(*) FROM orders WHERE company_id = $1`, w.companyID) != 0 {
		t.Fatal("the proposal is gone")
	}
	messages := w.assistantMessages(no)
	if messages[len(messages)-1][1] != "No problem: nothing was ordered." {
		t.Fatalf("ansa's fixed answer: %q", messages[len(messages)-1][1])
	}
}
