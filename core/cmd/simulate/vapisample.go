package main

import (
	"strings"
	"time"
)

// Made-up Vapi messages (the old scripts/vapi-sample.ts), with Vapi's field
// paths. Each holds what core must drop or ignore: an organization and a
// company id in the payload (the company comes from ansa's phone lines
// only), and, when asked, a recording on a host core never copies from.

// sampleTranscript is a call a person must follow up (a replacement).
var sampleTranscript = strings.Join([]string{
	"AI: Thanks for calling. How can I help you today?",
	"User: Hi, my order arrived yesterday and the screen is cracked.",
	"AI: I'm sorry to hear that. Can you tell me your order number?",
	"User: It's 48213. I'd like a replacement, not a refund.",
	"AI: I can't arrange replacements myself, so I'm passing this to our team.",
}, "\n")

// sampleCallerNumber is in the 555-01xx range kept for fiction.
const sampleCallerNumber = "+1 555 0142"

// A recording core must never copy, store or log: its host isn't allowed.
const ignoredRecordingURL = "https://storage.example.test/recordings/secret-recording.wav"

// sampleEndOfCallReport is a finished call as Vapi reports it.
func sampleEndOfCallReport(vapiCallID, numberID, caller, transcript string, withRecording bool) map[string]any {
	ended := time.Now().UTC()
	started := ended.Add(-3*time.Minute - 12*time.Second)
	artifact := map[string]any{"transcript": transcript, "messages": []any{}}
	if withRecording {
		artifact["recordingUrl"] = ignoredRecordingURL
	}
	return map[string]any{"message": map[string]any{
		"type":        "end-of-call-report",
		"endedReason": "customer-ended-call",
		"startedAt":   started.Format(time.RFC3339Nano),
		"endedAt":     ended.Format(time.RFC3339Nano),
		"artifact":    artifact,
		"call":        sampleCall(vapiCallID, numberID, map[string]any{"number": caller}),
	}}
}

// sampleToolCallsMessage is the live assistant calling ansa's knowledge
// search during a call: the question as an object argument, and the live
// transcript and the phone provider's secret, which core never keeps.
func sampleToolCallsMessage(vapiCallID, numberID, toolCallID, toolName, question string) map[string]any {
	toolCall := map[string]any{"id": toolCallID, "type": "function", "function": map[string]any{"name": toolName, "arguments": map[string]any{"query": question}}}
	return map[string]any{"message": map[string]any{
		"type":         "tool-calls",
		"timestamp":    time.Now().UnixMilli(),
		"toolCallList": []any{toolCall},
		"toolWithToolCallList": []any{map[string]any{
			"type": "function", "function": map[string]any{"name": toolName, "parameters": map[string]any{"type": "object"}}, "toolCall": toolCall,
		}},
		"call":        sampleCall(vapiCallID, numberID, nil),
		"customer":    map[string]any{"number": sampleCallerNumber},
		"artifact":    map[string]any{"transcript": "AI: Thanks for calling. How can I help?\nUser: " + question, "recordingUrl": ignoredRecordingURL},
		"phoneNumber": map[string]any{"provider": "twilio", "number": "+1 555 0100", "twilioAuthToken": "made-up-provider-secret"},
	}}
}

func sampleCall(vapiCallID, numberID string, customer map[string]any) map[string]any {
	call := map[string]any{
		"id": vapiCallID, "type": "inboundPhoneCall", "phoneNumberId": numberID,
		// Must be ignored: the company comes from ansa's phone lines only.
		"orgId": "attacker-org", "metadata": map[string]any{"companyId": "00000000-0000-4000-8000-000000000000"},
	}
	if customer != nil {
		call["customer"] = customer
	}
	return call
}
