package main

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"time"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/calls"
	"ansa/core/internal/commands"
	"ansa/core/internal/files"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
)

// solved-call saves a made-up call the AI marked "solved", to try "Escalate
// to a ticket" without the AI (the old `pnpm simulate:solved-call`). It
// runs IN THIS PROCESS, as the old script called the same code the webhook
// calls: the report goes to core's Vapi webhook handler (signed with a
// secret made for this run), then core's own call analysis decides it with
// a stand-in for the brain that answers "solved", quoting the customer's
// closing sentence. The brain's own check of that sentence doesn't run
// here (the brain is Python): the stand-in quotes the transcript exactly.
// The number must be the owner's company's (make link-phone-line). No core
// needs to be running; a running one may decide the call first with its
// own brain, and then this says so.
var solvedCallTool = tool{
	usage: "solved-call <owner email> <vapi phone number id>",
	does:  "writes a made-up call",
	fits:  exactly(2),
	run:   runSolvedCall,
}

const solvedConfirmation = "That fixed it, thank you so much."

// A call that sounds solved, but the customer's problem may well come back:
// what a teammate escalates.
var solvedTranscript = strings.Join([]string{
	"AI: Thanks for calling. How can I help?",
	"User: My router keeps dropping the connection every evening.",
	"AI: Let's restart it and change the wifi channel. Please unplug it for ten seconds.",
	"User: Okay, done. It's back and the connection looks stable now.",
	"AI: Great. Is there anything else?",
	"User: No, that's all. " + solvedConfirmation,
	"AI: You're welcome, goodbye.",
}, "\n")

// The stand-in brain's answer, in the brain's own shape (brain/brain/calls/decision.py).
var solvedDecision = map[string]any{
	"outcome": "solved", "source": "model", "reason_code": "model_solved",
	"customer_issue":      "The customer's router dropped the connection every evening.",
	"explanation":         "The agent changed the wifi channel and the customer confirmed it works.",
	"resolution_evidence": solvedConfirmation, "ticket_subject": nil, "category": nil,
	"model": "development stand-in",
}

func runSolvedCall(ctx context.Context, w *world, args []string) error {
	company, err := w.owner(ctx, args[0])
	if err != nil {
		return err
	}
	numberID := commands.CleanPhoneNumberID(args[1])
	if linked, err := commands.IsCompanysPhoneLine(ctx, w.pool, company.ID, numberID); err != nil || !linked {
		if err == nil {
			err = commands.Refusal("That number isn't linked to this company: link it first (make link-phone-line OWNER=... NUMBER=... YES=1).")
		}
		return err
	}
	// A new caller each run: one caller's calls are one customer, whose open
	// request would decide who gets the next one.
	vapiCallID := "sim-solved-" + randomHex(8)
	caller := fmt.Sprintf("+1 555 %d", 1000+rand.IntN(9000))
	if err := saveThroughTheWebhook(w, vapiCallID, numberID, caller); err != nil {
		return err
	}
	callID, err := commands.CallOfVapiID(ctx, w.pool, company.ID, vapiCallID)
	if err != nil || callID == "" {
		if err == nil {
			err = commands.Refusal("No call was saved: is the number still linked?")
		}
		return err
	}
	brain := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		json.NewEncoder(rw).Encode(solvedDecision)
	}))
	defer brain.Close()
	analyzer := &calls.Analyzer{Pool: w.pool, Box: w.box, Log: logging.New(os.Stderr), Brain: brainclient.New(brain.URL, randomHex(32), 10*time.Second)}
	outcome, err := analyzer.Analyze(ctx, company.ID, callID)
	if err != nil {
		return err
	}
	if outcome != "decided" {
		return commands.Refusal("A running core decided this call first, with its own brain. Stop core and run this again.")
	}
	fmt.Fprintf(w.out, "Saved a call the AI marked solved: %s/calls/%s\n", w.cfg.AppURL, callID)
	return nil
}

// saveThroughTheWebhook hands the report to core's Vapi webhook handler in
// this process, which saves it as it saves every call (its company from the
// phone line, the transcript encrypted, the caller's conversation).
func saveThroughTheWebhook(w *world, vapiCallID, numberID, caller string) error {
	signing := calls.Signing{Secret: randomHex(32), SignatureHeader: "x-signature", TimestampHeader: "x-timestamp",
		Algorithm: "sha256", Payload: "{timestamp}.{body}", Encoding: "hex", TimestampUnit: "seconds", ToleranceSeconds: 300}
	limiter := ratelimit.New(w.pool, w.cfg.AuthSecret)
	log := logging.New(os.Stderr)
	hook := &calls.Webhook{Pool: w.pool, Box: w.box, Limiter: limiter, Log: log, Signing: signing,
		RecordingHosts: w.cfg.VapiRecordingHosts, Files: &files.Store{DevFolder: w.cfg.DevFolder}, Tools: &calls.Tools{Pool: w.pool, Limiter: limiter, Log: log}}
	body, _ := json.Marshal(sampleEndOfCallReport(vapiCallID, numberID, caller, solvedTranscript, false))
	if status := serveInProcess(hook, "/webhooks/vapi", body, headersOf(signing.Headers(body, time.Now()))); status != http.StatusOK {
		return commands.Refusal(fmt.Sprintf("Core's Vapi webhook answered HTTP %d: no call was saved.", status))
	}
	return nil
}
