package assistant

import (
	"reflect"
	"strings"
	"testing"
)

// "Ask me first": the first automated message the customer RECEIVES starts
// with the AI label, whatever waited, was replaced or was discarded before.

const labelLine = "I'm the AI assistant for Luigi's.\n"

func askFirst(w *replyWorld) {
	mustExec(w.t, w.pool, `INSERT INTO assistant_settings (company_id, reply_mode) VALUES ($1, 'ask_first')`, w.companyID)
}

func TestAReplyThatReplacesAWaitingOneKeepsTheAILabel(t *testing.T) {
	w := newReplyWorld(t, `{"kind":"reply","text":"We open at 18:00."}`)
	askFirst(w)
	if got := w.answer(w.customerSays("lu", "When do you open?")); got != OutcomeDrafted {
		t.Fatalf("first: %s", got)
	}
	second := w.customerSays("lu", "Hello?")
	if got := w.answer(second); got != OutcomeDrafted {
		t.Fatalf("second: %s", got)
	}
	want := [][2]string{{"discarded", labelLine + "We open at 18:00."}, {"draft", labelLine + "We open at 18:00."}}
	if got := w.assistantMessages(second); !reflect.DeepEqual(got, want) {
		t.Fatalf("nothing reached the customer yet: the reply waiting now keeps the label: %q", got)
	}
	mustExec(t, w.pool, `UPDATE messages SET send_status = 'sent' WHERE company_id = $1 AND send_status = 'draft'`, w.companyID)
	third := w.customerSays("lu", "And on Sunday?")
	w.answer(third)
	if got := w.assistantMessages(third); got[len(got)-1] != [2]string{"draft", "We open at 18:00."} {
		t.Fatalf("once one reached the customer, the next has no label: %q", got[len(got)-1])
	}
}

func TestAHandoverWhileAReplyWaitsLabelsTheHoldingReplyAndDiscardsTheWaitingOne(t *testing.T) {
	w := newReplyWorld(t, `{"kind":"reply","text":"We open at 18:00."}`)
	askFirst(w)
	w.answer(w.customerSays("ma", "When do you open?"))
	w.brainAnswer = `{"kind":"needs_person","reason":"complaint","subject":"Cold pizza","summary":"The pizza arrived cold.","category":""}`
	complaint := w.customerSays("ma", "My pizza was cold!")
	if got := w.answer(complaint); got != OutcomeHandedOver {
		t.Fatalf("outcome: %s", got)
	}
	messages := w.assistantMessages(complaint)
	if len(messages) != 2 || messages[0] != [2]string{"discarded", labelLine + "We open at 18:00."} {
		t.Fatalf("the waiting reply answered a message the request now covers: it never goes: %q", messages)
	}
	if messages[1][0] != "sent" || !strings.HasPrefix(messages[1][1], labelLine) {
		t.Fatalf("the holding reply is the first the customer gets: it has the label: %q", messages[1])
	}
	if w.count(`SELECT count(*) FROM messages WHERE company_id = $1 AND send_status = 'draft'`, w.companyID) != 0 {
		t.Fatal("nothing waits to be sent after the holding reply")
	}
}

func TestAnOrderTextThatGoesFirstCarriesTheAILabel(t *testing.T) {
	w := newReplyWorld(t, `{"kind":"order_summary","order":{"items":[{"label":"M1","quantity":1}],"fulfilment":"pickup","address":"","time":"19:00","notes":""}}`)
	askFirst(w)
	w.answer(w.customerSays("no", "One Margherita to pick up at 19:00"))
	w.brainAnswer = `{"kind":"order_withdrawn"}`
	no := w.customerSays("no", "Actually no")
	if got := w.answer(no); got != OutcomeReplied {
		t.Fatalf("withdraw: %s", got)
	}
	messages := w.assistantMessages(no)
	if len(messages) != 2 || messages[0][0] != "discarded" || !strings.HasPrefix(messages[0][1], labelLine) {
		t.Fatalf("the waiting summary of the order taken back never goes: %q", messages)
	}
	if messages[1] != [2]string{"sent", labelLine + "No problem: nothing was ordered."} {
		t.Fatalf("ansa's own answer is the first the customer gets: it has the label: %q", messages[1])
	}
}
