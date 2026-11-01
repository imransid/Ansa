package calls

import (
	"context"
	"testing"
)

// savedCall saves one call through the webhook and returns its id.
func (w *callWorld) savedCall(name, caller string) string {
	vapiID := name + "-" + w.company.String()
	if code, _ := w.post(w.endOfCall(vapiID, caller, "AI: Hello.\nUser: My order is late.\nAI: Sorry.\nUser: Please call me."), true); code != 200 {
		w.t.Fatalf("saving the call: %d", code)
	}
	return w.callID(vapiID)
}

func TestACallThatNeedsAPersonGetsItsRequestInItsConversation(t *testing.T) {
	w := newCallWorld(t)
	ctx := context.Background()
	var categoryID string
	w.pool.QueryRow(ctx, `INSERT INTO categories (company_id, name) VALUES ($1, 'Orders') RETURNING id`, w.company.String()).Scan(&categoryID)
	callID := w.savedCall("late", "+39 051 555 0177")
	w.brainReply = `{"outcome":"needs_human","source":"model","reason_code":"model_needs_human","customer_issue":"Their order is late.",
		"explanation":"They want a call back.","ticket_subject":"Late order","category":"Orders","resolution_evidence":null,"model":"claude-sonnet-5-5"}`
	if outcome, err := w.analyzer.Analyze(ctx, w.company, callID); outcome != "decided" || err != nil {
		t.Fatalf("analyze: %s %v", outcome, err)
	}
	var subject, description, category, channel string
	var inConversation bool
	err := w.pool.QueryRow(ctx, `SELECT subject, description, category, channel::text, conversation_id IS NOT NULL FROM tickets WHERE company_id = $1 AND call_id = $2`,
		w.company.String(), callID).Scan(&subject, &description, &category, &channel, &inConversation)
	if err != nil || subject != "Late order" || category != "Orders" || channel != "phone" || !inConversation {
		t.Fatalf("the request: %q %q %q %v %v", subject, category, channel, inConversation, err)
	}
	if description != "Their order is late.\n\nThey want a call back.\n\nEscalated because: Claude judged that a human needs to follow up." {
		t.Fatalf("description: %q", description)
	}
	var activity int
	w.pool.QueryRow(ctx, `SELECT count(*) FROM assistant_activity WHERE company_id = $1 AND action = 'call_needs_person'`, w.company.String()).Scan(&activity)
	if activity != 1 {
		t.Fatal("ansa's line is in the conversation")
	}
	if outcome, _ := w.analyzer.Analyze(ctx, w.company, callID); outcome != "not-claimed" {
		t.Fatal("a decided call isn't analyzed again")
	}
}

func TestASolvedCallKeepsTheCustomersSentenceAndCanBeEscalatedOnce(t *testing.T) {
	w := newCallWorld(t)
	ctx := context.Background()
	callID := w.savedCall("solved", "+15550100")
	w.brainReply = `{"outcome":"solved","source":"model","reason_code":"model_solved","customer_issue":"The router.",
		"explanation":"It works.","ticket_subject":null,"category":null,"resolution_evidence":"That fixed it, thank you."}`
	if outcome, _ := w.analyzer.Analyze(ctx, w.company, callID); outcome != "decided" {
		t.Fatal("decided")
	}
	detail, err := Find(ctx, w.pool, w.webhook.Box, w.company, callID)
	if err != nil || detail == nil || detail.Analysis.Evidence == nil || *detail.Analysis.Evidence != "That fixed it, thank you." || !detail.Analysis.CanEscalate || detail.TicketNumber != nil {
		t.Fatalf("the solved call: %+v %v", detail, err)
	}
	number, err := Escalate(ctx, w.pool, w.webhook.Box, w.company, w.owner, callID, "", "Check the router again.")
	if err != nil || number == 0 {
		t.Fatalf("escalate: %d %v", number, err)
	}
	if again, _ := Escalate(ctx, w.pool, w.webhook.Box, w.company, w.owner, callID, "", ""); again != 0 {
		t.Fatal("a call is escalated once")
	}
	var outcome string
	var history int
	w.pool.QueryRow(ctx, `SELECT ai_outcome::text FROM calls WHERE company_id = $1 AND id = $2`, w.company.String(), callID).Scan(&outcome)
	w.pool.QueryRow(ctx, `SELECT count(*) FROM ticket_activity WHERE company_id = $1 AND kind = 'escalated'`, w.company.String()).Scan(&history)
	if outcome != "solved" || history != 1 {
		t.Fatalf("the AI's verdict stays, the history says who escalated: %s %d", outcome, history)
	}
}

func TestABrainThatDoesntAnswerOrSaysSolvedWithoutProofEscalates(t *testing.T) {
	w := newCallWorld(t)
	ctx := context.Background()
	silent := w.savedCall("silent", "+15550111")
	w.brainReply = ""
	w.analyzer.Analyze(ctx, w.company, silent)
	unproven := w.savedCall("unproven", "+15550122")
	w.brainReply = `{"outcome":"solved","source":"model","reason_code":"model_solved","resolution_evidence":""}`
	w.analyzer.Analyze(ctx, w.company, unproven)
	for id, want := range map[string]string{silent: "model_error", unproven: "invalid_output"} {
		var outcome, reason string
		var errorClass *string
		var requests int
		w.pool.QueryRow(ctx, `SELECT ai_outcome::text, ai_reason_code, ai_error_class, (SELECT count(*) FROM tickets WHERE company_id = $1 AND call_id = $2) FROM calls WHERE company_id = $1 AND id = $2`,
			w.company.String(), id).Scan(&outcome, &reason, &errorClass, &requests)
		if outcome != "needs_human" || reason != want || requests != 1 {
			t.Fatalf("%s: %s %s %d", want, outcome, reason, requests)
		}
		if want == "model_error" && (errorClass == nil || *errorClass != "BrainUnavailable") {
			t.Fatal("the class is kept")
		}
	}
}
