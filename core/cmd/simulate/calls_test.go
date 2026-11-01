package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"ansa/core/internal/calls"
	"ansa/core/internal/config"
	"ansa/core/internal/files"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
)

// linkNumber links a made-up Vapi number to the test company.
func (w *testWorld) linkNumber() string {
	number := "pn-simulate-" + randomHex(6)
	if _, err := w.pool.Exec(context.Background(), `INSERT INTO phone_lines (company_id, vapi_phone_number_id) VALUES ($1, $2)`, w.company.String(), number); err != nil {
		w.t.Fatalf("linking: %v", err)
	}
	return number
}

// runningCore serves core's real Vapi webhook on the test database at a
// local address, as a running core with the same VAPI_* settings would.
func (w *testWorld) runningCore() string {
	w.settings["VAPI_WEBHOOK_SECRET"] = strings.Repeat("v", 40)
	cfg, err := config.Load(func(name string) string { return w.settings[name] })
	if err != nil {
		w.t.Fatal(err)
	}
	limiter := ratelimit.New(w.pool, w.settings["BETTER_AUTH_SECRET"])
	log := logging.New(io.Discard)
	hook := &calls.Webhook{Pool: w.pool, Box: w.box, Limiter: limiter, Log: log, Signing: calls.SigningFrom(cfg), RecordingHosts: cfg.VapiRecordingHosts,
		Files: &files.Store{DevFolder: w.t.TempDir()}, Tools: &calls.Tools{Pool: w.pool, Limiter: limiter, Log: log}}
	server := httptest.NewServer(hook)
	w.t.Cleanup(server.Close)
	w.forgetRateLimits([2]string{"vapi-webhook", "127.0.0.1"}, [2]string{"knowledge-lookups", w.company.String()})
	return server.URL
}

// Every variant gets the answer it should from core's real webhook: the
// good ones are saved (a repeated call once), the bad ones refused.
func TestVapiCallSendsEveryVariantToTheRunningCore(t *testing.T) {
	w := newTestWorld(t)
	number := w.linkNumber()
	if _, err := w.run("vapi-call", number); err == nil || !strings.Contains(err.Error(), "VAPI_WEBHOOK_SECRET") {
		t.Fatalf("without the secret: %v", err)
	}
	address := w.runningCore()
	if _, err := w.run("vapi-call", number, "--core", "https://core.example.com"); err == nil || !strings.Contains(err.Error(), "a core on this computer") {
		t.Fatalf("a core elsewhere: %v", err)
	}
	if _, err := w.run("vapi-call", number, "sideways", "--core", address); err == nil || !strings.Contains(err.Error(), "Unknown variant") {
		t.Fatalf("an unknown variant: %v", err)
	}
	out, err := w.run("vapi-call", number, "all", "--core", address)
	if err != nil || strings.Contains(out, "FAIL") || strings.Count(out, "OK  ") != len(vapiVariants) {
		t.Fatalf("all: %q %v", out, err)
	}
	if saved := w.count(`SELECT count(*) FROM calls WHERE company_id = $1`); saved != 2 {
		t.Fatalf("valid and duplicate are two calls, got %d", saved)
	}
}

// The live knowledge search answers as for the voice assistant, records
// the lookup under the call, and --end-call saves the call itself.
func TestVapiToolCallAsksTheRunningCoresKnowledgeSearch(t *testing.T) {
	w := newTestWorld(t)
	number := w.linkNumber()
	address := w.runningCore()
	out, err := w.run("vapi-tool-call", number, "When are you open?", "--core", address)
	if err != nil || !strings.Contains(out, "Tool call answered with HTTP 200") || !strings.Contains(out, "result: ") {
		t.Fatalf("asked: %q %v", out, err)
	}
	vapiCallID := regexp.MustCompile(`Call: (\S+)`).FindStringSubmatch(out)[1]
	if out, err := w.run("vapi-tool-call", "--call", vapiCallID, number, "And on Sunday?", "--end-call", "--core", address); err != nil || !strings.Contains(out, "End-of-call report answered with HTTP 200") {
		t.Fatalf("again in the same call, then ended: %q %v", out, err)
	}
	if w.count(`SELECT count(*) FROM knowledge_lookups WHERE company_id = $1 AND vapi_call_id = $2`, vapiCallID) != 2 ||
		w.count(`SELECT count(*) FROM calls WHERE company_id = $1 AND vapi_call_id = $2`, vapiCallID) != 1 {
		t.Fatal("two lookups under one call, and the call saved")
	}
}

// The call goes through core's webhook code and core's analysis, decided
// by the stand-in: solved, with the customer's sentence, and no request.
func TestSolvedCallSavesACallTheStandInMarkedSolved(t *testing.T) {
	w := newTestWorld(t)
	w.forgetRateLimits([2]string{"vapi-webhook", "127.0.0.1"})
	if _, err := w.run("solved-call", w.owner, "pn-nobodys"); err == nil || !strings.Contains(err.Error(), "link-phone-line") {
		t.Fatalf("a number that isn't the company's: %v", err)
	}
	number := w.linkNumber()
	out, err := w.run("solved-call", w.owner, number)
	match := regexp.MustCompile(`/calls/([0-9a-f-]{36})`).FindStringSubmatch(out)
	if err != nil || match == nil {
		t.Fatalf("saved: %q %v", out, err)
	}
	var outcome, reason, evidence string
	err = w.pool.QueryRow(context.Background(), `SELECT ai_outcome::text, ai_reason_code, ai_evidence_encrypted FROM calls WHERE company_id = $1 AND id = $2`,
		w.company.String(), match[1]).Scan(&outcome, &reason, &evidence)
	sentence, _ := w.box.Decrypt(evidence, calls.EvidenceContext(w.company, match[1]))
	if err != nil || outcome != "solved" || reason != "model_solved" || sentence != solvedConfirmation {
		t.Fatalf("the decision: %q %q %q %v", outcome, reason, sentence, err)
	}
	if w.count(`SELECT count(*) FROM tickets WHERE company_id = $1`) != 0 {
		t.Fatal("a solved call has no request")
	}
}

// A dry run through core's analysis to the brain at BRAIN_URL: codes only,
// nothing claimed or saved; only the owner's company's calls.
func TestTryBrainPrintsTheVerdictAndSavesNothing(t *testing.T) {
	w := newTestWorld(t)
	asked := ""
	brain := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		asked = r.URL.Path
		io.WriteString(rw, `{"outcome":"needs_human","source":"model","reason_code":"model_needs_human","customer_issue":"A private issue",
			"explanation":"x","ticket_subject":"Late order","category":null,"resolution_evidence":null,"model":"claude-sonnet-5-5"}`)
	}))
	defer brain.Close()
	w.settings["BRAIN_URL"] = brain.URL
	ctx := context.Background()
	var lineID, callID string
	w.pool.QueryRow(ctx, `INSERT INTO phone_lines (company_id, vapi_phone_number_id) VALUES ($1, $2) RETURNING id`, w.company.String(), "pn-try-"+randomHex(6)).Scan(&lineID)
	vapiCallID := "sim-try-" + randomHex(6)
	transcript, _ := w.box.Encrypt("AI: Hello.\nUser: My order is late.", calls.TranscriptContext(w.company, vapiCallID))
	w.pool.QueryRow(ctx, `INSERT INTO calls (company_id, phone_line_id, vapi_call_id, transcript_encrypted) VALUES ($1, $2, $3, $4) RETURNING id`,
		w.company.String(), lineID, vapiCallID, transcript).Scan(&callID)
	out, err := w.run("try-brain", w.owner, strings.ToUpper(callID))
	if err != nil || asked != "/v1/calls/decide" || !strings.Contains(out, "Outcome: needs_human") || !strings.Contains(out, "Dry run: nothing was saved.") || strings.Contains(out, "private issue") {
		t.Fatalf("tried: %q %v", out, err)
	}
	if w.count(`SELECT count(*) FROM calls WHERE company_id = $1 AND analysis_status = 'pending'`) != 1 || w.count(`SELECT count(*) FROM tickets WHERE company_id = $1`) != 0 {
		t.Fatal("nothing claimed or saved")
	}
	other := newTestWorld(t)
	other.settings["BRAIN_URL"] = brain.URL
	if _, err := other.run("try-brain", other.owner, callID); err == nil || !strings.Contains(err.Error(), "no call with that id") {
		t.Fatalf("another company's call: %v", err)
	}
	if _, err := w.run("try-brain", w.owner, "not-a-call"); err == nil || !strings.Contains(err.Error(), "isn't a call id") {
		t.Fatalf("not an id: %v", err)
	}
}
