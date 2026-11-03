package phone

import "testing"

// A call left live (the practice page reloaded, closed or left without
// hanging up) is ended by the same caller's next call as hanging up would
// have ended it: nothing of it is lost.

// Its minutes are counted, its note is queued, and the message ansa took
// gets its request.
func TestACallLeftLiveIsEndedAsHangingUpWould(t *testing.T) {
	w := newCallWorld(t, `{"kind":"reply","text":"Of course. Who should call you back?"}`)
	w.exec(`INSERT INTO assistant_settings (company_id, status) VALUES ($1, 'paused')`, w.companyID)
	left := w.start()
	w.say(left.CallID, "Please call me back about a party of twenty")
	w.exec(`UPDATE phone_calls SET started_at = now() - interval '90 seconds' WHERE company_id = $1 AND id = $2`, w.companyID, left.CallID)
	again := w.start()
	if w.count(`SELECT count(*) FROM phone_calls WHERE company_id = $1 AND id = $2 AND ended_at IS NOT NULL`, w.companyID, left.CallID) != 1 ||
		w.count(`SELECT count(*) FROM phone_calls WHERE company_id = $1 AND ended_at IS NULL AND id = $2`, w.companyID, again.CallID) != 1 {
		t.Fatal("the call left live is over; the new one is the live one")
	}
	if w.count(`SELECT count(*) FROM usage_months WHERE company_id = $1 AND call_seconds BETWEEN 89 AND 95`, w.companyID) != 1 {
		t.Fatal("its minute and a half counted")
	}
	if w.count(`SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = 'phone.call_summary' AND payload->>'callId' = $2`, w.companyID, left.CallID) != 1 {
		t.Fatal("its note is written after it")
	}
	if w.count(`SELECT count(*) FROM tickets WHERE company_id = $1 AND subject = 'A caller left a message' AND status = 'open'`, w.companyID) != 1 ||
		w.count(`SELECT count(*) FROM core_jobs WHERE company_id = $1 AND kind = 'owner.alert'`, w.companyID) != 1 {
		t.Fatal("the message it took gets its request, and the owners their alert")
	}
	w.brainAnswer = `{"kind":"ok","subject":"Party of twenty","summary":"Wants a call back about a party of twenty.","needs_person":true}`
	w.runNote(left.CallID)
	if w.count(`SELECT count(*) FROM tickets WHERE company_id = $1 AND subject = 'Party of twenty' AND description LIKE '%After the call: Wants a call back%'`, w.companyID) != 1 {
		t.Fatal("its note joins that request, opened as the call ended, and gives it its subject")
	}
}

// Its note is written while the next call goes on: it joins a request that
// call opened, but never gives it its subject (it is the next call's).
func TestTheNoteOfACallLeftLiveKeepsTheNextCallsSubject(t *testing.T) {
	w := newCallWorld(t, `{"kind":"reply","text":"Of course, I'll note it."}`)
	left := w.start()
	w.say(left.CallID, "It's Lena: please call me back about a party of twenty")
	again := w.start()
	w.brainAnswer = `{"kind":"needs_person","reason":"complaint","subject":"Cold pizza","summary":"Lena's pizza arrived cold.","text":"I'm so sorry. I'll pass this on."}`
	w.say(again.CallID, "And my pizza was cold yesterday!")
	w.brainAnswer = `{"kind":"ok","subject":"Party of twenty","summary":"Lena wants a call back about a party of twenty.","needs_person":true}`
	w.runNote(left.CallID)
	if w.count(`SELECT count(*) FROM tickets WHERE company_id = $1 AND subject = 'Cold pizza' AND description LIKE '%After the call: Lena wants a call back%'`, w.companyID) != 1 {
		t.Fatal("the note of the call before joins the open request, and leaves its subject")
	}
	w.hangUp(again.CallID)
	w.brainAnswer = `{"kind":"ok","subject":"Cold pizza yesterday","summary":"Lena's pizza arrived cold yesterday.","needs_person":true}`
	w.runNote(again.CallID)
	if w.count(`SELECT count(*) FROM tickets WHERE company_id = $1`, w.companyID) != 1 ||
		w.count(`SELECT count(*) FROM tickets WHERE company_id = $1 AND subject = 'Cold pizza yesterday'`, w.companyID) != 1 {
		t.Fatal("the call that opened the request gives it its note's subject")
	}
}
