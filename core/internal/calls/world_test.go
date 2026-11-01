package calls

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/database"
	"ansa/core/internal/files"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// callWorld is one test company with a phone line, core's webhook and a
// fake brain answering what the test sets.
type callWorld struct {
	t          *testing.T
	pool       *database.Pool
	company    tenant.CompanyID
	owner      string
	numberID   string
	webhook    *Webhook
	analyzer   *Analyzer
	brainReply string
}

var testSigning = Signing{Secret: strings.Repeat("v", 40), SignatureHeader: "x-signature", TimestampHeader: "x-timestamp",
	Algorithm: "sha256", Payload: "{timestamp}.{body}", Encoding: "hex", TimestampUnit: "seconds", ToleranceSeconds: 300}

// The address the webhook's requests come from (its per-IP counter is the test's).
const testIP = "192.0.2.77"

func newCallWorld(t *testing.T) *callWorld {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	w := &callWorld{t: t, pool: pool, company: company, owner: database.TestOwner(t, pool, companyID), numberID: "vapi-number-" + companyID}
	if _, err := pool.Exec(context.Background(), `INSERT INTO phone_lines (company_id, vapi_phone_number_id) VALUES ($1, $2)`, companyID, w.numberID); err != nil {
		t.Fatalf("phone line: %v", err)
	}
	brain := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		if w.brainReply == "" {
			rw.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		io.WriteString(rw, w.brainReply)
	}))
	t.Cleanup(brain.Close)
	box, _ := secure.NewBox("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	limiter := ratelimit.New(pool, "core-test-secret")
	log := logging.New(io.Discard)
	w.webhook = &Webhook{Pool: pool, Box: box, Limiter: limiter, Log: log, Signing: testSigning, Files: &files.Store{DevFolder: t.TempDir()},
		Tools: &Tools{Pool: pool, Limiter: limiter, Log: log}}
	w.analyzer = &Analyzer{Pool: pool, Box: box, Log: log, Brain: brainclient.New(brain.URL, strings.Repeat("s", 40), 5*time.Second)}
	t.Cleanup(func() {
		ctx := context.Background()
		pool.Exec(ctx, `DELETE FROM rate_limits WHERE key = ANY($1)`, []string{limiter.Key("vapi-webhook", testIP), limiter.Key("knowledge-lookups", companyID)})
	})
	return w
}

// post sends a body to the webhook, signed unless told otherwise.
func (w *callWorld) post(body any, signed bool) (int, []byte) {
	raw, _ := json.Marshal(body)
	request := httptest.NewRequest(http.MethodPost, "/webhooks/vapi", bytes.NewReader(raw))
	request.Header.Set("X-Forwarded-For", testIP)
	if signed {
		for name, value := range testSigning.Headers(raw, time.Now()) {
			request.Header.Set(name, value)
		}
	}
	recorder := httptest.NewRecorder()
	w.webhook.ServeHTTP(recorder, request)
	return recorder.Code, recorder.Body.Bytes()
}

// endOfCall is an end-of-call report for this world's line.
func (w *callWorld) endOfCall(vapiCallID, caller, transcript string) map[string]any {
	return map[string]any{"message": map[string]any{
		"type": "end-of-call-report", "endedReason": "customer-ended-call",
		"artifact": map[string]any{"transcript": transcript},
		"call":     map[string]any{"id": vapiCallID, "phoneNumberId": w.numberID, "customer": map[string]any{"number": caller}},
	}}
}

// callID is the saved call's id for Vapi's id ("" = none saved).
func (w *callWorld) callID(vapiCallID string) string {
	var id string
	w.pool.QueryRow(context.Background(), `SELECT id FROM calls WHERE company_id = $1 AND vapi_call_id = $2`, w.company.String(), vapiCallID).Scan(&id)
	return id
}
