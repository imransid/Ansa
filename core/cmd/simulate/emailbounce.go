package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ansa/core/internal/commands"
	"ansa/core/internal/resend"
)

// email-bounce tells the RUNNING core, the way Resend would, that one of the
// emails in .dev-emails/ bounced, was marked as spam, or was suppressed or
// failed at Resend (the old `pnpm simulate:email-bounce`): a signed event
// over HTTP, signed with core's own Standard Webhooks code and the running
// core's RESEND_WEBHOOK_SECRET. The request's page, and for the last three
// kinds the Emails page's "not delivered" list, then show it.
var emailBounceTool = tool{
	usage: "email-bounce <file in .dev-emails/> [" + strings.Join(bounceKinds, "|") + "] [--core <address>]",
	does:  "sends a made-up delivery problem to core",
	fits:  coreArgsFit(1, 2),
	run:   runEmailBounce,
}

var bounceKinds = []string{"bounced", "complained", "suppressed", "failed"}

func runEmailBounce(ctx context.Context, w *world, args []string) error {
	address, args, err := coreAddressOf(w.cfg, args)
	if err != nil {
		return err
	}
	kind := "bounced"
	if len(args) == 2 {
		kind = args[1]
	}
	if !contains(bounceKinds, kind) {
		return commands.Refusal(fmt.Sprintf("Unknown kind %q. Use one of: %s.", kind, strings.Join(bounceKinds, ", ")))
	}
	if refusal := emailWebhookRefusal(w); refusal != nil {
		return refusal
	}
	fileName := filepath.Base(args[0])
	if info, err := os.Stat(filepath.Join(w.cfg.DevFolder, ".dev-emails", fileName)); err != nil || !info.Mode().IsRegular() {
		return commands.Refusal("There is no such file in .dev-emails/.")
	}
	// The development outbox records "dev-outbox:<file name>" where Resend's id would be.
	event, _ := json.Marshal(map[string]any{"type": "email." + kind, "created_at": time.Now().UTC().Format(time.RFC3339),
		"data": map[string]any{"email_id": "dev-outbox:" + fileName}})
	status, _, err := postToCore(ctx, address, "/webhooks/resend", event, resend.Sign(event, "msg_"+randomHex(12), w.cfg.ResendWebhookSecret, time.Now()))
	if err != nil {
		return err
	}
	fmt.Fprintf(w.out, "%s: got %d (expected 200). Reload the request's page.\n", kind, status)
	if status != 200 {
		return commands.Refusal("Core didn't answer as expected.")
	}
	return nil
}
