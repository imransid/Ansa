package api

import (
	"context"
	"testing"

	"ansa/core/internal/database"
)

func TestTheCallsPageListsTheCompanysCallsOnly(t *testing.T) {
	w := newAPIWorld(t)
	ctx := context.Background()
	t.Cleanup(func() {
		w.pool.Exec(ctx, `DELETE FROM rate_limits WHERE key = $1`, w.api.Limiter.Key("ticket-creations", w.ownerID()))
	})
	var lineID, callID string
	w.pool.QueryRow(ctx, `INSERT INTO phone_lines (company_id, vapi_phone_number_id) VALUES ($1, $2) RETURNING id`, w.company.String(), "line-"+w.company.String()).Scan(&lineID)
	w.pool.QueryRow(ctx, `INSERT INTO calls (company_id, phone_line_id, vapi_call_id, caller_number, created_at) VALUES ($1, $2, $3, '+39 051 555 0177', now() - interval '1 hour') RETURNING id`,
		w.company.String(), lineID, "c-"+w.company.String()).Scan(&callID)
	otherID := database.TestCompany(t, w.pool)
	var otherLine, otherCall string
	w.pool.QueryRow(ctx, `INSERT INTO phone_lines (company_id, vapi_phone_number_id) VALUES ($1, $2) RETURNING id`, otherID, "line-"+otherID).Scan(&otherLine)
	w.pool.QueryRow(ctx, `INSERT INTO calls (company_id, phone_line_id, vapi_call_id, caller_number) VALUES ($1, $2, $3, '+15550100') RETURNING id`, otherID, otherLine, "c-"+otherID).Scan(&otherCall)

	code, answer := w.call("GET", "/api/v1/calls?outcome=stuck&q=0515550177", "", screensSecret, w.cookie)
	list, _ := answer["calls"].([]any)
	counts, _ := answer["counts"].(map[string]any)
	if code != 200 || len(list) != 1 || counts["all"] != float64(1) || counts["stuck"] != float64(1) {
		t.Fatalf("a never-analyzed call an hour old is stuck, found by its digits: %d %+v", code, answer)
	}
	code, answer = w.call("GET", "/api/v1/calls/"+callID, "", screensSecret, w.cookie)
	call, _ := answer["call"].(map[string]any)
	analysis, _ := call["analysis"].(map[string]any)
	if code != 200 || analysis["canAnalyzeNow"] != true || analysis["canEscalate"] != false {
		t.Fatalf("the call page: %d %+v", code, answer)
	}
	if code, _ := w.call("GET", "/api/v1/calls/"+otherCall, "", screensSecret, w.cookie); code != 404 {
		t.Fatalf("another company's call: %d", code)
	}
	if code, _ := w.call("POST", "/api/v1/calls/"+otherCall+"/escalate", `{"note":""}`, screensSecret, w.cookie); code != 409 {
		t.Fatalf("another company's call can't be escalated: %d", code)
	}
}
