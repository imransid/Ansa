package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"ansa/core/internal/commands"
	"ansa/core/internal/resend"
)

// inbound-email sends a made-up customer email to the RUNNING core the way
// Resend would (the old `pnpm simulate:inbound-email`): it writes the
// content to <ANSA_DEV_FOLDER>/.dev-inbound/<id>.json (core's stand-in for
// Resend's Receiving API) and posts a signed "email.received" event over
// HTTP, signed with core's own Standard Webhooks code and the running
// core's RESEND_WEBHOOK_SECRET, addressed to a company's forwarding
// address. The running core then makes a request of it as of any email.
var inboundEmailTool = tool{
	usage: "inbound-email <owner email or forwarding address> [" + strings.Join(inboundVariants, "|") + "] [--core <address>]",
	does:  "sends a made-up customer email to core",
	fits:  coreArgsFit(1, 2),
	run:   runInboundEmail,
}

var forwardingLocalPart = regexp.MustCompile(`^c-[0-9a-f]{32}$`)

func runInboundEmail(ctx context.Context, w *world, args []string) error {
	address, args, err := coreAddressOf(w.cfg, args)
	if err != nil {
		return err
	}
	variant := "valid"
	if len(args) == 2 {
		variant = args[1]
	}
	if !contains(inboundVariants, variant) {
		return commands.Refusal(fmt.Sprintf("Unknown variant %q. Use one of: %s.", variant, strings.Join(inboundVariants, ", ")))
	}
	if refusal := emailWebhookRefusal(w); refusal != nil {
		return refusal
	}
	if w.cfg.SendRealEmail {
		return commands.Refusal(`SEND_REAL_EMAIL is "true": the running core would ask Resend for this made-up email instead of reading .dev-inbound/. Switch it off to simulate.`)
	}
	forwarding, err := forwardingAddressOf(ctx, w, args[0])
	if err != nil {
		return err
	}
	emailID := randomHex(16)
	to, cc := inboundRecipients(variant, forwarding)
	content := inboundContent(variant, to)
	if err := writeDevInbound(w.cfg.DevFolder, emailID, content); err != nil {
		return err
	}
	event, _ := json.Marshal(map[string]any{"type": "email.received", "created_at": time.Now().UTC().Format(time.RFC3339),
		"data": map[string]any{"email_id": emailID, "from": content["from"], "to": to, "cc": cc, "bcc": []string{}, "received_for": []string{}, "subject": content["subject"]}})
	expected, headers := 200, resend.Sign(event, "msg_"+randomHex(12), w.cfg.ResendWebhookSecret, time.Now())
	if variant == "unsigned" {
		expected, headers = 401, nil
	}
	status, _, err := postToCore(ctx, address, "/webhooks/resend", event, headers)
	if err != nil {
		return err
	}
	fmt.Fprintf(w.out, "%s: got %d (expected %d). Sent to %s.\n", variant, status, expected, forwarding)
	if status != expected {
		return commands.Refusal("Core didn't answer as expected.")
	}
	return nil
}

// forwardingAddressOf is the forwarding address given, or the forwarding
// address of the given owner's company.
func forwardingAddressOf(ctx context.Context, w *world, given string) (string, error) {
	domain := w.cfg.ForwardingDomain()
	local, host, found := strings.Cut(strings.ToLower(strings.TrimSpace(given)), "@")
	if found && host == domain && forwardingLocalPart.MatchString(local) {
		return local + "@" + host, nil
	}
	company, err := w.owner(ctx, given)
	if err != nil {
		return "", err
	}
	return commands.ForwardingAddress(ctx, w.pool, company.ID, domain)
}

// emailWebhookRefusal: Resend's webhook needs its signing secret in .env.core.
func emailWebhookRefusal(w *world) error {
	if w.cfg.ResendWebhookSecret == "" {
		return commands.Refusal(`Set RESEND_WEBHOOK_SECRET in .env.core first (the value the running core reads; in development any "whsec_" and base64 will do).`)
	}
	return nil
}

// writeDevInbound writes the email where core's stand-in reads it.
func writeDevInbound(devFolder, emailID string, content map[string]any) error {
	folder := filepath.Join(devFolder, ".dev-inbound")
	if err := os.MkdirAll(folder, 0o700); err != nil {
		return err
	}
	raw, _ := json.Marshal(content)
	return os.WriteFile(filepath.Join(folder, emailID+".json"), raw, 0o600)
}

func contains(list []string, value string) bool {
	for _, entry := range list {
		if entry == value {
			return true
		}
	}
	return false
}
