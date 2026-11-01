package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"ansa/core/internal/calls"
	"ansa/core/internal/commands"
)

// vapi-tool-call asks the RUNNING core's knowledge search as Vapi's voice
// assistant does during a live call (the old `pnpm
// simulate:vapi-tool-call`), over HTTP, signed with core's own signing code
// from the VAPI_* settings, and prints the answer the assistant would get
// (the company's own approved articles). --call looks it up during an
// earlier call (an id an earlier run printed), so one call can make several
// lookups; --end-call then ends the call with its end-of-call report, so
// the call and what it looked up show on the Calls page.
var vapiToolCallTool = tool{
	usage: `vapi-tool-call <vapi phone number id> "<question>" [--call <vapi call id>] [--end-call] [--core <address>]`,
	does:  "sends a made-up live call's question to core",
	fits: func(args []string) bool {
		_, rest, okCall := takeValue(args, "--call")
		_, rest = takeSwitch(rest, "--end-call")
		return okCall && coreArgsFit(2, 2)(rest)
	},
	run: runVapiToolCall,
}

func runVapiToolCall(ctx context.Context, w *world, args []string) error {
	address, args, err := coreAddressOf(w.cfg, args)
	if err != nil {
		return err
	}
	if w.cfg.VapiWebhookSecret == "" {
		return commands.Refusal("Set VAPI_WEBHOOK_SECRET in .env.core first (the value the running core reads: it refuses every call without one).")
	}
	vapiCallID, args, _ := takeValue(args, "--call")
	if vapiCallID == "" {
		vapiCallID = "sim-" + randomHex(8)
	}
	endCall, args := takeSwitch(args, "--end-call")
	numberID, question := strings.TrimSpace(args[0]), args[1]
	sender := vapiSender{address: address, signing: calls.SigningFrom(w.cfg)}
	fmt.Fprintf(w.out, "Call: %s\n", vapiCallID)
	message, _ := json.Marshal(sampleToolCallsMessage(vapiCallID, numberID, "toolu_"+randomHex(8), calls.KnowledgeToolName, question))
	status, answer, err := postToCore(ctx, sender.address, "/webhooks/vapi", message, headersOf(sender.signing.Headers(message, time.Now())))
	if err != nil {
		return err
	}
	fmt.Fprintf(w.out, "Tool call answered with HTTP %d\n", status)
	printToolAnswer(w, answer)
	if status != 200 {
		return commands.Refusal("The tool call wasn't answered 200.")
	}
	if !endCall {
		return nil
	}
	report, _ := json.Marshal(sampleEndOfCallReport(vapiCallID, numberID, sampleCallerNumber, sampleTranscript, false))
	ended, err := sender.signed(ctx, report, time.Now())
	if err != nil {
		return err
	}
	fmt.Fprintf(w.out, "End-of-call report answered with HTTP %d. Open Calls (%s/calls) to see what the call looked up.\n", ended, w.cfg.AppURL)
	if ended != 200 {
		return commands.Refusal("The end-of-call report wasn't answered 200.")
	}
	return nil
}

// printToolAnswer prints each entry of core's answer: the result the
// assistant would read, or the error it would be told.
func printToolAnswer(w *world, answer []byte) {
	var read calls.ToolAnswer
	if json.Unmarshal(answer, &read) != nil {
		fmt.Fprintln(w.out, "The answer was not JSON.")
		return
	}
	if len(read.Results) == 0 {
		fmt.Fprintln(w.out, "No results in the answer.")
	}
	for _, entry := range read.Results {
		if entry.Error != "" {
			fmt.Fprintf(w.out, "error:  %s\n", entry.Error)
			continue
		}
		fmt.Fprintf(w.out, "result: %s\n", entry.Result)
	}
}
