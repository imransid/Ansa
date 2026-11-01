package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"ansa/core/internal/calls"
	"ansa/core/internal/commands"
	"ansa/core/internal/config"
)

// vapi-call sends a made-up end-of-call report to the RUNNING core over
// HTTP (as the old `pnpm simulate:vapi-call` posted to the running app),
// signed with core's own signing code from the VAPI_* settings (the
// running core must read the same VAPI_WEBHOOK_SECRET). Other variants send
// bad requests to show core refuses them. The number must be linked to a
// company first (make link-phone-line); the running core then decides the
// call with its brain.
var vapiCallTool = tool{
	usage: "vapi-call <vapi phone number id> [" + strings.Join(vapiVariantNames(), "|") + "|all] [--core <address>]",
	does:  "sends made-up calls to core",
	fits:  coreArgsFit(1, 2),
	run:   runVapiCall,
}

// vapiSender posts to the running core's Vapi webhook.
type vapiSender struct {
	address string
	signing calls.Signing
}

func (s vapiSender) post(ctx context.Context, body []byte, headers http.Header) (int, error) {
	status, _, err := postToCore(ctx, s.address, "/webhooks/vapi", body, headers)
	return status, err
}

func (s vapiSender) signed(ctx context.Context, body []byte, at time.Time) (int, error) {
	return s.post(ctx, body, headersOf(s.signing.Headers(body, at)))
}

type vapiVariant struct {
	name     string
	expected int
	send     func(ctx context.Context, s vapiSender, numberID string) (int, error)
}

// reportFor is a new call (a new id) on the number.
func reportFor(numberID string) []byte {
	body, _ := json.Marshal(sampleEndOfCallReport("sim-"+randomHex(8), numberID, sampleCallerNumber, sampleTranscript, true))
	return body
}

var vapiVariants = []vapiVariant{
	{"valid", 200, func(ctx context.Context, s vapiSender, line string) (int, error) {
		return s.signed(ctx, reportFor(line), time.Now())
	}},
	{"duplicate", 200, func(ctx context.Context, s vapiSender, line string) (int, error) {
		body := reportFor(line)
		if _, err := s.signed(ctx, body, time.Now()); err != nil {
			return 0, err
		}
		// The same call again: answered 200, saved once.
		return s.signed(ctx, body, time.Now())
	}},
	{"unsigned", 401, func(ctx context.Context, s vapiSender, line string) (int, error) {
		return s.post(ctx, reportFor(line), nil)
	}},
	{"bad-signature", 401, func(ctx context.Context, s vapiSender, line string) (int, error) {
		// Signed for one call, sent with another.
		return s.post(ctx, reportFor(line), headersOf(s.signing.Headers(reportFor(line), time.Now())))
	}},
	{"stale", 401, func(ctx context.Context, s vapiSender, line string) (int, error) {
		return s.signed(ctx, reportFor(line), time.Now().Add(-10*time.Minute))
	}},
	{"too-large", 413, func(ctx context.Context, s vapiSender, _ string) (int, error) {
		return s.signed(ctx, bytes.Repeat([]byte("a"), 1<<20+1), time.Now())
	}},
	{"unknown-line", 200, func(ctx context.Context, s vapiSender, _ string) (int, error) {
		return s.signed(ctx, reportFor("unknown-"+randomHex(8)), time.Now())
	}},
	{"other-event", 200, func(ctx context.Context, s vapiSender, _ string) (int, error) {
		return s.signed(ctx, []byte(`{"message":{"type":"status-update","status":"in-progress"}}`), time.Now())
	}},
}

func vapiVariantNames() []string {
	var names []string
	for _, variant := range vapiVariants {
		names = append(names, variant.name)
	}
	return names
}

func runVapiCall(ctx context.Context, w *world, args []string) error {
	address, args, err := coreAddressOf(w.cfg, args)
	if err != nil {
		return err
	}
	if w.cfg.VapiWebhookSecret == "" {
		return commands.Refusal("Set VAPI_WEBHOOK_SECRET in .env.core first (the value the running core reads: it refuses every call without one).")
	}
	chosen := "valid"
	if len(args) == 2 {
		chosen = args[1]
	}
	var toRun []vapiVariant
	for _, variant := range vapiVariants {
		if chosen == "all" || chosen == variant.name {
			toRun = append(toRun, variant)
		}
	}
	if len(toRun) == 0 {
		return commands.Refusal(fmt.Sprintf("Unknown variant %q. Use one of: all, %s.", chosen, strings.Join(vapiVariantNames(), ", ")))
	}
	sender := vapiSender{address: address, signing: calls.SigningFrom(w.cfg)}
	failed := 0
	for _, variant := range toRun {
		status, err := variant.send(ctx, sender, strings.TrimSpace(args[0]))
		if err != nil {
			return err
		}
		verdict := "OK  "
		if status != variant.expected {
			verdict, failed = "FAIL", failed+1
		}
		fmt.Fprintf(w.out, "%s %-14s got %d, expected %d\n", verdict, variant.name, status, variant.expected)
	}
	if failed > 0 {
		return commands.Refusal(fmt.Sprintf("%d of %d answered otherwise than expected.", failed, len(toRun)))
	}
	return nil
}

// coreArgsFit: between least and most arguments once --core <address> is out.
func coreArgsFit(least, most int) func([]string) bool {
	return func(args []string) bool {
		_, rest, ok := takeValue(args, "--core")
		return ok && between(least, most)(rest)
	}
}

// coreAddressOf takes --core out of the arguments and checks the address
// (a core on this computer; without --core, the running core's own).
func coreAddressOf(cfg config.Config, args []string) (string, []string, error) {
	given, rest, _ := takeValue(args, "--core")
	address, err := commands.CoreAddress(given, cfg)
	return address, rest, err
}
