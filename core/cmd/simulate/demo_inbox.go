package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/calls"
	"ansa/core/internal/commands"
	"ansa/core/internal/files"
	"ansa/core/internal/inbound"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/resend"
)

// The restaurant's calls (the Calls page, Home's numbers): a phone line
// linked as ansa's operator links one, and two finished calls as the phone
// provider reports them, through core's own webhook in this process (signed
// with a secret made for this run). Core's analyzer then decides each one
// here, with the scripted brain: the same every time, and no AI at reset.
func addDemoCalls(ctx context.Context, w *world, a demoAccount) error {
	line := "demo-line-" + a.company.String()[:8]
	if linked, err := commands.LinkPhoneLine(ctx, w.pool, a.company, line); err != nil || !linked {
		if err != nil {
			return err
		}
		return commands.Refusal("The demo's phone line wasn't linked.")
	}
	limiter := ratelimit.New(w.pool, w.cfg.AuthSecret)
	signing := calls.SigningFrom(w.cfg)
	signing.Secret = randomHex(32)
	callHook := &calls.Webhook{Pool: w.pool, Box: w.box, Limiter: limiter, Log: logging.New(io.Discard), Signing: signing,
		RecordingHosts: w.cfg.VapiRecordingHosts, Files: &files.Store{DevFolder: w.cfg.DevFolder}, Tools: &calls.Tools{Pool: w.pool, Limiter: limiter, Log: logging.New(io.Discard)}}
	brain := newScriptedBrain()
	defer brain.server.Close()
	analyzer := &calls.Analyzer{Pool: w.pool, Box: w.box, Brain: brainclient.New(brain.server.URL, w.cfg.BrainSharedSecret, 30*time.Second), Log: logging.New(io.Discard)}
	for _, call := range demoCalls {
		body, _ := json.Marshal(sampleEndOfCallReport("demo-"+randomHex(8), line, call.caller, strings.Join(call.transcript, "\n"), false))
		if status := serveInProcess(callHook, "/webhooks/vapi", body, headersOf(signing.Headers(body, time.Now()))); status != http.StatusOK {
			return commands.Refusal("A demo call wasn't saved by core's webhook.")
		}
		var callID string
		if err := w.pool.QueryRow(ctx, `SELECT id::text FROM calls WHERE company_id = $1 AND caller_number = $2`, a.company.String(), call.caller).Scan(&callID); err != nil {
			return err
		}
		// The running core may have taken it first: then it decides it.
		brain.next(call.decision)
		if _, err := analyzer.Analyze(ctx, a.company, callID); err != nil {
			return err
		}
	}
	return dropQueuedJobs(ctx, w, a, calls.AnalyzeJobKind)
}

// addDemoEmails sends emails to the company's forwarding address through
// core's own Resend webhook (in this process, signed with a secret made for
// this run), then core's processor reads each one here, with the scripted
// brain's triage.
func addDemoEmails(ctx context.Context, w *world, a demoAccount, emails []demoEmail) error {
	forwarding, err := commands.ForwardingAddress(ctx, w.pool, a.company, w.cfg.ForwardingDomain())
	if err != nil {
		return err
	}
	secret, err := webhookSecret()
	if err != nil {
		return err
	}
	limiter := ratelimit.New(w.pool, w.cfg.AuthSecret)
	emailHook := &resend.Webhook{Pool: w.pool, Limiter: limiter, Log: logging.New(io.Discard), Secret: secret, ForwardingDomain: w.cfg.ForwardingDomain()}
	brain := newScriptedBrain()
	defer brain.server.Close()
	processor := &inbound.Processor{Pool: w.pool, Box: w.box, Limiter: limiter, Log: logging.New(io.Discard), Fetcher: &resend.Fetcher{DevFolder: w.cfg.DevFolder},
		Brain: brainclient.New(brain.server.URL, w.cfg.BrainSharedSecret, 30*time.Second), EmailFrom: w.cfg.EmailFrom, ForwardingDomain: w.cfg.ForwardingDomain()}
	for _, email := range emails {
		emailID := randomHex(16)
		content := map[string]any{"from": email.address, "to": []string{forwarding}, "reply_to": []string{}, "subject": email.subject, "text": email.text,
			"html": nil, "attachments": []any{}, "headers": map[string]string{"from": email.name + " <" + email.address + ">"},
			"authentication": map[string]string{"spf": "pass", "dkim": "pass", "dmarc": "pass"}}
		if err := resend.WriteDevInbound(w.cfg.DevFolder, emailID, content); err != nil {
			return err
		}
		event, _ := json.Marshal(map[string]any{"type": "email.received", "created_at": time.Now().UTC().Format(time.RFC3339),
			"data": map[string]any{"email_id": emailID, "from": email.address, "to": []string{forwarding}, "cc": []string{}, "bcc": []string{}, "received_for": []string{}, "subject": email.subject}})
		if status := serveInProcess(emailHook, "/webhooks/resend", event, resend.Sign(event, "msg_"+randomHex(12), secret, time.Now())); status != http.StatusOK {
			return commands.Refusal("A demo email wasn't saved by core's webhook.")
		}
		var rowID string
		if err := w.pool.QueryRow(ctx, `SELECT id::text FROM inbound_emails WHERE company_id = $1 AND resend_email_id = $2`, a.company.String(), emailID).Scan(&rowID); err != nil {
			return err
		}
		brain.next(email.triage)
		if _, err := processor.Process(ctx, a.company, rowID, inbound.ClaimAgain, true); err != nil {
			return err
		}
	}
	return dropQueuedJobs(ctx, w, a, resend.ProcessJobKind)
}

// dropQueuedJobs deletes the company's waiting jobs of one kind: what they
// would do was done here.
func dropQueuedJobs(ctx context.Context, w *world, a demoAccount, kind string) error {
	_, err := w.pool.Exec(ctx, `DELETE FROM core_jobs WHERE company_id = $1 AND kind = $2 AND status = 'queued'`, a.company.String(), kind)
	return err
}
