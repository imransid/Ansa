package calls

import (
	"context"
	"testing"
)

// The development tool's dry run asks the brain as the analysis does, and
// claims and saves nothing: the call is still waiting for its analysis.
func TestTryingADecisionClaimsAndSavesNothing(t *testing.T) {
	w := newCallWorld(t)
	ctx := context.Background()
	callID := w.savedCall("tried", "+15550100")
	w.brainReply = `{"outcome":"needs_human","source":"model","reason_code":"model_needs_human","customer_issue":"Late.",
		"explanation":"A call back.","ticket_subject":"Late order","category":null,"resolution_evidence":null,"model":"claude-sonnet-5-5"}`
	tried, err := w.analyzer.TryDecision(ctx, w.company, callID)
	if err != nil || tried.Outcome != "needs_human" || tried.ReasonCode != "model_needs_human" || tried.Source != "model" || tried.Model != "claude-sonnet-5-5" {
		t.Fatalf("tried: %+v %v", tried, err)
	}
	var status string
	var tickets int
	w.pool.QueryRow(ctx, `SELECT analysis_status::text FROM calls WHERE company_id = $1 AND id = $2`, w.company.String(), callID).Scan(&status)
	w.pool.QueryRow(ctx, `SELECT count(*) FROM tickets WHERE company_id = $1`, w.company.String()).Scan(&tickets)
	if status != "pending" || tickets != 0 {
		t.Fatalf("nothing claimed or saved: %s, %d requests", status, tickets)
	}
	w.brainReply = ""
	if tried, _ := w.analyzer.TryDecision(ctx, w.company, callID); tried.ReasonCode != "model_error" || tried.ErrorClass != "BrainUnavailable" {
		t.Fatalf("a brain that doesn't answer: %+v", tried)
	}
	other := newCallWorld(t)
	if _, err := other.analyzer.TryDecision(ctx, other.company, callID); err != ErrNoSuchCall {
		t.Fatalf("another company's call: %v", err)
	}
}
