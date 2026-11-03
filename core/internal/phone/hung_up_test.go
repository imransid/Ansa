package phone

import (
	"context"
	"testing"
)

// A caller who hangs up while the AI is thinking never hears its answer:
// nothing of it is saved (no words, no request, no order), and the call
// ends when they hung up. Their own words stay in the conversation, for the
// call's note.
func TestNothingIsSavedForACallerWhoHungUpWhileTheAIThought(t *testing.T) {
	for _, answer := range []string{
		`{"kind":"reply","text":"We close at 23:00."}`,
		`{"kind":"needs_person","reason":"asked_for_person","subject":"Lena called","summary":"Lena asks for Luigi.","text":"I'll pass it on."}`,
		`{"kind":"order_summary","order":{"items":[{"label":"M1","quantity":2}],"fulfilment":"pickup","address":"","time":"19:00 today","notes":""}}`,
	} {
		w := newCallWorld(t, answer)
		w.exec(`INSERT INTO assistant_settings (company_id, pickup) VALUES ($1, true)`, w.companyID)
		call := w.start()
		var hangUpErr error
		w.whileThinking = func() { hangUpErr = w.phone.End(context.Background(), w.company, call.CallID) }
		words, err := w.phone.Turn(context.Background(), w.company, call.CallID, "When do you close? And is Luigi there?")
		if err != nil || hangUpErr != nil || len(words) != 0 {
			t.Fatalf("%s: nothing is said after the hang-up: %q %v %v", answer, words, err, hangUpErr)
		}
		if w.count(`SELECT count(*) FROM messages WHERE company_id = $1 AND direction = 'out'`, w.companyID) != 1 ||
			w.count(`SELECT count(*) FROM messages WHERE company_id = $1 AND direction = 'in'`, w.companyID) != 1 ||
			w.count(`SELECT count(*) FROM tickets WHERE company_id = $1`, w.companyID) != 0 ||
			w.count(`SELECT count(*) FROM orders WHERE company_id = $1`, w.companyID) != 0 ||
			w.count(`SELECT count(*) FROM assistant_activity WHERE company_id = $1`, w.companyID) != 0 {
			t.Fatalf("%s: only the greeting and the caller's words are in the conversation", answer)
		}
		if w.count(`SELECT count(*) FROM phone_calls WHERE company_id = $1 AND ended_at IS NOT NULL`, w.companyID) != 1 {
			t.Fatal("the call ended when they hung up")
		}
	}
}
