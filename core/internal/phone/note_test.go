package phone

import (
	"context"
	"strings"
	"testing"

	"ansa/core/internal/assistant"
	"ansa/core/internal/jobs"
)

// runNote runs the call's note job as the worker would.
func (w *callWorld) runNote(callID string) {
	job := &jobs.Job{ID: "22222222-2222-4222-8222-222222222222", CompanyID: w.company, Kind: assistant.CallSummaryJobKind, Payload: []byte(`{"callId":"` + callID + `"}`)}
	if err := w.phone.Assistant.HandleCallSummaryJob(context.Background(), job); err != nil {
		w.t.Fatalf("the note job: %v", err)
	}
}

func (w *callWorld) hangUp(callID string) {
	if err := w.phone.End(context.Background(), w.company, callID); err != nil {
		w.t.Fatal(err)
	}
}

// When the caller hangs up, the AI's note opens a request when someone has
// to act, joins the request already open, and a call the AI fully helped
// with needs nobody.
func TestTheCallsNoteReachesThePerson(t *testing.T) {
	w := newCallWorld(t, `{"kind":"reply","text":"Of course, I'll note it."}`)
	call := w.start()
	w.say(call.CallID, "It's Lena: please call me back about a party of twenty")
	w.hangUp(call.CallID)
	w.brainAnswer = `{"kind":"ok","subject":"Party of twenty","summary":"Lena wants a call back about a party of twenty.","needs_person":true}`
	w.runNote(call.CallID)
	if w.count(`SELECT count(*) FROM tickets WHERE company_id = $1 AND channel = 'phone' AND status = 'open' AND subject = 'Party of twenty' AND description LIKE '%Lena wants a call back%' AND customer_phone = '393331234567'`, w.companyID) != 1 ||
		w.count(`SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = 'owner.alert' AND payload->>'reason' = 'call_note'`, w.companyID) != 1 {
		t.Fatal("a request with the note and the caller's number, and the owners' alert")
	}
	// ansa answered the call: it took no message and told nobody someone gets back to them.
	if w.count(`SELECT count(*) FROM tickets WHERE company_id = $1 AND description LIKE $2`, w.companyID, assistant.ReasonText["call_note"]+"%") != 1 ||
		w.count(`SELECT count(*) FROM assistant_activity WHERE company_id = $1 AND action = 'call_needs_person' AND reason IS NULL`, w.companyID) != 1 ||
		w.count(`SELECT count(*) FROM assistant_activity WHERE company_id = $1 AND action = 'handed_over'`, w.companyID) != 0 {
		t.Fatal("the request and ansa's line say ansa noted something after the call, never that the caller left a message")
	}
	if !strings.Contains(w.lastBody, `"sender":"customer","text":"It's Lena: please call me back about a party of twenty"`) ||
		!strings.Contains(w.lastBody, `"name":"Luigi's"`) || !strings.Contains(w.lastBody, `"caller_name":"Lena"`) || !strings.Contains(w.lastBody, `"orders_placed":[]`) ||
		strings.Contains(w.lastBody, call.ConversationID) || strings.Contains(w.lastBody, w.companyID) {
		t.Fatalf("the brain reads the call's words, who ansa answered for and the line's name for the caller, never an id: %s", w.lastBody)
	}

	again := w.start()
	w.brainAnswer = `{"kind":"reply","text":"Noted."}`
	w.say(again.CallID, "Me again: make it twenty-two")
	w.hangUp(again.CallID)
	w.brainAnswer = `{"kind":"ok","subject":"More people","summary":"Now twenty-two people.","needs_person":true}`
	w.runNote(again.CallID)
	if w.count(`SELECT count(*) FROM tickets WHERE company_id = $1`, w.companyID) != 1 ||
		w.count(`SELECT count(*) FROM tickets WHERE company_id = $1 AND description LIKE '%After the call: Now twenty-two people.'`, w.companyID) != 1 {
		t.Fatal("the note joins the open request")
	}

	other, err := w.phone.Start(context.Background(), w.company, Caller{Line: LinePractice, Number: "+39 333 765 4321", Name: "Marco"})
	if err != nil {
		t.Fatal(err)
	}
	w.brainAnswer = `{"kind":"reply","text":"Yes, until 23:00."}`
	w.say(other.CallID, "Are you open tonight?")
	w.hangUp(other.CallID)
	w.brainAnswer = `{"kind":"ok","subject":"Opening hours","summary":"Marco asked if they're open tonight; ansa said until 23:00.","needs_person":false}`
	w.runNote(other.CallID)
	w.brainAnswer = `{"kind":"failed","reason":"model_failed"}`
	w.runNote(other.CallID)
	if w.count(`SELECT count(*) FROM tickets WHERE company_id = $1`, w.companyID) != 1 {
		t.Fatal("a call ansa fully helped with needs nobody, and a note that failed changes nothing")
	}
}

// A caller marked important: the AI only takes their message, and the
// request says why it came to the person.
func TestAnImportantCallerIsHandedOverAsSuch(t *testing.T) {
	w := newCallWorld(t, `{"kind":"needs_person","reason":"asked_for_person","subject":"Lena called","summary":"Lena asks for a call back.","text":"I'll tell them right away. What's it about?"}`)
	first := w.start()
	w.hangUp(first.CallID)
	w.exec(`UPDATE contacts SET important = true WHERE company_id = $1 AND channel = 'phone'`, w.companyID)
	call := w.start()
	if !strings.Contains(call.Words[0], "please tell me your message") {
		t.Fatalf("the greeting says it takes a message: %q", call.Words)
	}
	if words := w.say(call.CallID, "Is Luigi there?"); words[0] != "I'll tell them right away. What's it about?" || w.modes[len(w.modes)-1] != "message_only" {
		t.Fatalf("the AI only takes the message: %q", words)
	}
	if w.count(`SELECT count(*) FROM assistant_activity WHERE company_id = $1 AND action = 'handed_over' AND reason = 'important_person'`, w.companyID) != 1 {
		t.Fatal("the request says they're one of your important people")
	}
}

// A request ansa opened during the call gets the note's subject (the whole
// call, not its first words); a subject a person changed is never replaced.
func TestTheNoteGivesARequestOpenedOnTheCallItsSubject(t *testing.T) {
	w := newCallWorld(t, `{"kind":"needs_person","reason":"asked_for_person","subject":"Caller asks for the owner","summary":"Asks for the owner.","text":"They're not here: what's it about?"}`)
	call := w.start()
	w.say(call.CallID, "Is the owner there?")
	w.brainAnswer = `{"kind":"reply","text":"I'll pass it on."}`
	w.say(call.CallID, "Tell him the wine delivery comes Friday.")
	w.hangUp(call.CallID)
	w.brainAnswer = `{"kind":"ok","subject":"Wine delivery on Friday","summary":"The supplier says the wine comes on Friday.","needs_person":true}`
	w.runNote(call.CallID)
	if w.count(`SELECT count(*) FROM tickets WHERE company_id = $1 AND subject = 'Wine delivery on Friday'`, w.companyID) != 1 ||
		w.count(`SELECT count(*) FROM ticket_activity WHERE company_id = $1 AND kind = 'subject_changed' AND actor_user_id IS NULL`, w.companyID) != 1 {
		t.Fatal("the request takes the note's subject, recorded as the app's change")
	}

	again := w.start()
	w.brainAnswer = `{"kind":"reply","text":"Noted."}`
	w.say(again.CallID, "Make it Saturday instead.")
	w.hangUp(again.CallID)
	w.brainAnswer = `{"kind":"ok","subject":"Wine on Saturday","summary":"Now Saturday.","needs_person":true}`
	w.runNote(again.CallID)
	if w.count(`SELECT count(*) FROM tickets WHERE company_id = $1 AND subject = 'Wine delivery on Friday' AND description LIKE '%After the call: Now Saturday.'`, w.companyID) != 1 {
		t.Fatal("a request from before this call keeps its subject; the note joins it")
	}
}

// An order placed on the call is done: the note's AI is told its number (so
// it waits for nobody), and with nothing else left no request is opened.
func TestAnOrderPlacedOnTheCallIsNoRequest(t *testing.T) {
	w := newCallWorld(t, `{"kind":"order_summary","order":{"items":[{"label":"M1","quantity":2}],"fulfilment":"pickup","address":"","time":"19:00 today","notes":""}}`)
	w.exec(`INSERT INTO assistant_settings (company_id, pickup) VALUES ($1, true)`, w.companyID)
	call := w.start()
	w.say(call.CallID, "Two Margherita for pickup at seven tonight")
	w.brainAnswer = `{"kind":"order_confirmed"}`
	w.say(call.CallID, "Yes")
	w.hangUp(call.CallID)
	w.brainAnswer = `{"kind":"ok","subject":"Pickup order","summary":"Lena ordered two Margherita for pickup at 19:00 today.","needs_person":false}`
	w.runNote(call.CallID)
	if !strings.Contains(w.lastBody, `"orders_placed":[1]`) {
		t.Fatalf("the note's AI knows the call placed order #1: %s", w.lastBody)
	}
	if w.count(`SELECT count(*) FROM tickets WHERE company_id = $1`, w.companyID) != 0 ||
		w.count(`SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = 'owner.alert'`, w.companyID) != 0 {
		t.Fatal("no request and no 'needs you' alert for an order ansa fully handled")
	}
}
