package assistant

import (
	"context"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/conversations"
	"ansa/core/internal/packages"
)

// Step 57: each AI reply counts against the package; with none left (or
// the free trial over) ansa never goes silent: the holding reply and a
// request, the AI not asked. A business's own Claude key isn't counted.
func TestUsedUpAIRepliesSendTheHoldingReplyWithoutTheAI(t *testing.T) {
	w := newReplyWorld(t, `{"kind":"reply","text":"Yes, until 23:00."}`)
	if w.answer(w.customerSays("lena", "Are you open?")) != OutcomeReplied {
		t.Fatal("a reply")
	}
	if used, _ := packages.ReadUsage(context.Background(), w.pool, w.company, time.Now()); used.AIReplies != 1 {
		t.Fatalf("counted: %d", used.AIReplies)
	}
	mustExec(t, w.pool, `UPDATE usage_months SET ai_replies = $2 WHERE company_id = $1`, w.companyID, packages.Trial.AIReplies)
	asked := w.brainCalls
	turn := w.customerSays("marco", "Do you deliver?")
	if w.answer(turn) != OutcomeHandedOver || w.brainCalls != asked {
		t.Fatal("used up: handed over, the AI not asked")
	}
	messages := w.assistantMessages(turn)
	if len(messages) != 1 || !strings.Contains(messages[0][1], "get back to you") ||
		w.count(`SELECT count(*) FROM assistant_activity WHERE company_id = $1 AND reason = 'package_used_up'`, w.companyID) != 1 {
		t.Fatalf("the holding reply and a request saying why: %v", messages)
	}

	key, _ := w.box.Encrypt("sk-ant-own-key", KeyContext(w.company))
	mustExec(t, w.pool, `INSERT INTO assistant_settings (company_id, anthropic_key_encrypted, anthropic_key_hint) VALUES ($1, $2, 'ykey')`, w.companyID, key)
	if w.answer(w.customerSays("anna", "Hi!")) != OutcomeReplied {
		t.Fatal("the business's own key answers, never counted")
	}
}

// A package without Messenger (Personal) or without orders hands those
// over to a person.
func TestAPersonalPackageHasNoMessengerAndNoOrders(t *testing.T) {
	w := newReplyWorld(t, `{"kind":"reply","text":"Hi!"}`)
	mustExec(t, w.pool, `INSERT INTO company_billing (company_id, stripe_customer_id, stripe_subscription_id, status, package) VALUES ($1, $2, $3, 'active', 'personal')`,
		w.companyID, "cus_"+w.companyID, "sub_"+w.companyID)
	id, _ := conversations.NewID()
	body, _ := w.box.Encrypt("Hello", conversations.MessageContext(w.company, id))
	turn, err := conversations.InsertCustomerMessage(context.Background(), w.pool, w.company,
		conversations.ContactKey{Channel: conversations.ChannelMessenger, ExternalID: "90901:4242"}, conversations.IncomingMessage{ID: id, BodyEncrypted: body, ChannelMessageID: id})
	if err != nil {
		t.Fatal(err)
	}
	if w.answer(*turn) != OutcomeHandedOver || w.count(`SELECT count(*) FROM assistant_activity WHERE company_id = $1 AND reason = 'not_in_package'`, w.companyID) != 1 || w.brainCalls != 0 {
		t.Fatal("Messenger isn't in Personal: handed over, the AI not asked")
	}
	inputs, err := GatherInputs(context.Background(), w.pool, w.box, w.company, "", time.Now())
	if err != nil || inputs.Ordering.TakesOrders || inputs.Request.Orders.TakesOrders {
		t.Fatalf("no orders in Personal: %v", err)
	}
}
