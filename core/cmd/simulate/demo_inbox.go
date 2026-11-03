package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"ansa/core/internal/calls"
	"ansa/core/internal/commands"
	"ansa/core/internal/files"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/resend"
)

// The restaurant's calls and emails (the Calls and Emails pages, Home's
// numbers): a phone line linked as ansa's operator links one, two finished
// calls as the phone provider reports them, and two emails forwarded to the
// restaurant's address, each through core's own webhook in this process
// (signed with a secret made for this run). The running core then decides
// the calls and reads the emails with the AI (Claude Code on this computer),
// a few seconds after the reset, as it does any.
func addDemoCallsAndEmails(ctx context.Context, w *world, a demoAccount) error {
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
	for _, call := range demoCalls {
		body, _ := json.Marshal(sampleEndOfCallReport("demo-"+randomHex(8), line, call.caller, strings.Join(call.transcript, "\n"), false))
		if status := serveInProcess(callHook, "/webhooks/vapi", body, headersOf(signing.Headers(body, time.Now()))); status != http.StatusOK {
			return commands.Refusal("A demo call wasn't saved by core's webhook.")
		}
	}
	forwarding, err := commands.ForwardingAddress(ctx, w.pool, a.company, w.cfg.ForwardingDomain())
	if err != nil {
		return err
	}
	key := make([]byte, 24)
	if _, err := rand.Read(key); err != nil {
		return err
	}
	secret := "whsec_" + base64.StdEncoding.EncodeToString(key)
	emailHook := &resend.Webhook{Pool: w.pool, Limiter: limiter, Log: logging.New(io.Discard), Secret: secret, ForwardingDomain: w.cfg.ForwardingDomain()}
	for _, email := range demoEmails {
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
	}
	return nil
}

// demoCall is one finished call: who called and what was said, one turn a line.
type demoCall struct {
	caller     string
	transcript []string
}

var demoCalls = []demoCall{
	{"+880 1711 000101", []string{
		"AI: Thanks for calling Shapla Kitchen. How can I help you today?",
		"User: Hi, I'd like food for an office lunch on Thursday, about 35 people.",
		"AI: Lovely! For 20 guests or more our manager prepares a catering menu and a price. May I take your name?",
		"User: It's Mahbub from Delta Office. You can call me back on this number.",
		"AI: Thank you, Mahbub. Our manager will call you back today with a menu.",
	}},
	{"+880 1811 000202", []string{
		"AI: Thanks for calling Shapla Kitchen. How can I help you today?",
		"User: Hi, are you open on Friday evening?",
		"AI: Yes, on Friday we're open from 10:00 until midnight.",
		"User: Do we need to book a table for six people?",
		"AI: For six people, send us a message on WhatsApp and we keep the family room ready for you.",
		"User: Perfect, that answers my question. Thank you so much.",
		"AI: You're welcome. See you on Friday!",
	}},
}

// demoEmail is one email forwarded to the restaurant.
type demoEmail struct {
	name, address, subject, text string
}

var demoEmails = []demoEmail{
	{"Lamia Chowdhury", "lamia.chowdhury@example.com", "Booking the family room for a birthday",
		"Hello,\n\nWe'd like to book your family room for my mother's 60th birthday on Saturday 15 November, about 18 people, at 7 pm. Can you arrange a set menu with kacchi and firni?\n\nThanks,\nLamia"},
	{"Farzana Ahmed", "farzana@deltaoffice.example", "A monthly lunch account for our office",
		"Dear Shapla Kitchen,\n\nOur office of 25 people would like to order lunch every weekday. Do you offer a monthly account with one invoice?\n\nRegards,\nFarzana Ahmed\nDelta Office"},
}
