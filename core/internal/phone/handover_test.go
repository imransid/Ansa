package phone

import (
	"context"
	"strings"
	"testing"

	"ansa/core/internal/assistant"
	"ansa/core/internal/packages"
)

// Handovers, message-only turns and limits on a call: the AI keeps talking
// for the whole call, and every message reaches a request.

// A handover doesn't end the conversation: the caller hears the AI's own
// words (checked by core), one request is opened, and every later turn is
// still the AI's, the request staying the only one.
func TestAfterAHandoverTheCallGoesOnWithTheAI(t *testing.T) {
	w := newCallWorld(t, `{"kind":"needs_person","reason":"complaint","subject":"Cold pizza","summary":"Lena's pizza arrived cold.","text":"I'm so sorry. I'll pass this on to the team: what's your name?"}`)
	call := w.start()
	words := w.say(call.CallID, "My pizza was cold!")
	if len(words) != 1 || words[0] != "I'm so sorry. I'll pass this on to the team: what's your name?" {
		t.Fatalf("the AI's own words, spoken: %q", words)
	}
	if w.count(`SELECT count(*) FROM tickets WHERE company_id = $1 AND channel = 'phone' AND subject = 'Cold pizza' AND status = 'open'`, w.companyID) != 1 ||
		w.count(`SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = 'owner.alert' AND payload->>'holdingMessageId' = ''`, w.companyID) != 1 {
		t.Fatal("a request from the call, marked as a phone request, and the owners alerted")
	}
	w.brainAnswer = `{"kind":"reply","text":"Thank you, Lena. Anything else for the team?"}`
	if words := w.say(call.CallID, "It's Lena."); len(words) != 1 || words[0] != "Thank you, Lena. Anything else for the team?" || w.modes[len(w.modes)-1] != "answer" {
		t.Fatalf("the request open, the AI still answers: %q", words)
	}
	// Words that fail core's checks are never spoken.
	w.brainAnswer = `{"kind":"needs_person","reason":"refund","subject":"","summary":"","text":"We'll refund you, of course."}`
	if words := w.say(call.CallID, "I want my money back."); len(words) != 1 || words[0] != assistant.MessageTakenText("business", "Luigi's") {
		t.Fatalf("a refund promise isn't said: %q", words)
	}
	if err := w.phone.End(context.Background(), w.company, call.CallID); err != nil {
		t.Fatal(err)
	}
	if w.count(`SELECT count(*) FROM tickets WHERE company_id = $1`, w.companyID) != 1 ||
		w.count(`SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = 'phone.call_summary'`, w.companyID) != 1 {
		t.Fatal("one request for the whole call; its note is written after the call")
	}
}

// Without words of the AI's own (none, or the AI unavailable), the caller
// hears the business's holding reply.
func TestAHandoverWithoutWordsSaysTheHoldingReply(t *testing.T) {
	w := newCallWorld(t, `{"kind":"failed","reason":"model_failed"}`)
	call := w.start()
	if words := w.say(call.CallID, "Hello?"); len(words) != 1 || !strings.Contains(words[0], "get back to you") {
		t.Fatalf("the holding reply, spoken: %q", words)
	}
	if w.count(`SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = 'owner.alert' AND payload->>'holdingMessageId' <> ''`, w.companyID) != 1 {
		t.Fatal("the alert says they heard the holding reply")
	}
}

// Paused (or a person handling the conversation, or an important caller):
// the AI only takes a message, and hanging up opens one request for it.
func TestWhilePausedTheAIOnlyTakesAMessage(t *testing.T) {
	w := newCallWorld(t, `{"kind":"reply","text":"Of course. Who should call you back?"}`)
	w.exec(`INSERT INTO assistant_settings (company_id, status) VALUES ($1, 'paused')`, w.companyID)
	call := w.start()
	if !strings.Contains(call.Words[0], "please tell me your message") {
		t.Fatalf("the greeting says it takes a message: %q", call.Words)
	}
	if words := w.say(call.CallID, "Please call me back about a party of twenty"); words[0] != "Of course. Who should call you back?" || w.modes[0] != "message_only" {
		t.Fatalf("the AI takes the message: %q (%v)", words, w.modes)
	}
	w.brainAnswer = `{"kind":"order_summary","order":{"items":[{"label":"M1","quantity":2}],"fulfilment":"pickup","address":"","time":"","notes":""}}`
	w.say(call.CallID, "And two Margherita")
	if w.count(`SELECT count(*) FROM orders WHERE company_id = $1`, w.companyID) != 0 {
		t.Fatal("no order is taken while ansa only takes messages")
	}
	if words := w.say(call.CallID, "   "); words[0] != DidntCatchText {
		t.Fatalf("nothing heard: %q", words)
	}
	ctx := context.Background()
	if err := w.phone.End(ctx, w.company, call.CallID); err != nil {
		t.Fatal(err)
	}
	if w.count(`SELECT count(*) FROM tickets WHERE company_id = $1 AND channel = 'phone' AND status = 'open'`, w.companyID) != 1 ||
		w.count(`SELECT count(*) FROM assistant_activity WHERE company_id = $1 AND action = 'handed_over'`, w.companyID) != 1 ||
		w.count(`SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = 'owner.alert'`, w.companyID) != 1 {
		t.Fatal("one request for the message, ansa's line and the owners' alert")
	}
	if w.count(`SELECT count(*) FROM tickets WHERE company_id = $1 AND description LIKE '%party of twenty%'`, w.companyID) != 0 {
		t.Fatal("the caller's own words stay in the (encrypted) conversation, never on the request")
	}
	if err := w.phone.End(ctx, w.company, call.CallID); err != nil || w.count(`SELECT count(*) FROM tickets WHERE company_id = $1`, w.companyID) != 1 {
		t.Fatal("ending twice changes nothing")
	}
}

// Past a caller's hourly turns the AI isn't asked: ansa's fixed words take the message.
func TestPastTheCallLimitAnsaTakesMessagesWithoutTheAI(t *testing.T) {
	w := newCallWorld(t, `{"kind":"reply","text":"never said"}`)
	call := w.start()
	w.exec(`INSERT INTO rate_limits (key, attempt_count, window_started_at) VALUES ($1, 60, now())`, w.limiter.Key("assistant-call", call.ConversationID))
	if words := w.say(call.CallID, "Hello?"); words[0] != assistant.MessageTakenText("business", "Luigi's") || w.brainCalls != 0 {
		t.Fatalf("no AI past the limit: %q (%d)", words, w.brainCalls)
	}
	if err := w.phone.End(context.Background(), w.company, call.CallID); err != nil {
		t.Fatal(err)
	}
	if w.count(`SELECT count(*) FROM tickets WHERE company_id = $1 AND subject = 'A caller left a message'`, w.companyID) != 1 {
		t.Fatal("the message gets its request")
	}
}

// Step 57: each call's length counts against the package's call minutes;
// with none left, the greeting takes a message and the AI isn't asked.
func TestCallMinutesComeFromThePackage(t *testing.T) {
	w := newCallWorld(t, `{"kind":"reply","text":"Yes, until 23:00."}`)
	call := w.start()
	w.exec(`UPDATE phone_calls SET started_at = now() - interval '90 seconds' WHERE company_id = $1 AND id = $2`, w.companyID, call.CallID)
	if err := w.phone.End(context.Background(), w.company, call.CallID); err != nil {
		t.Fatal(err)
	}
	if w.count(`SELECT count(*) FROM usage_months WHERE company_id = $1 AND call_seconds BETWEEN 89 AND 95`, w.companyID) != 1 {
		t.Fatal("the call's minute and a half counted once")
	}
	w.exec(`UPDATE usage_months SET call_seconds = $2 WHERE company_id = $1`, w.companyID, packages.Trial.CallMinutes*60)
	again := w.start()
	if !strings.Contains(again.Words[0], "please tell me your message") {
		t.Fatalf("no minutes left: the greeting takes a message: %q", again.Words)
	}
	if words := w.say(again.CallID, "Are you open tonight?"); words[0] != assistant.MessageTakenText("business", "Luigi's") || w.brainCalls != 0 {
		t.Fatalf("no AI: %q (%d brain calls)", words, w.brainCalls)
	}
}
