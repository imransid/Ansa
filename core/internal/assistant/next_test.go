package assistant

import (
	"context"
	"testing"
	"time"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
)

func (w *replyWorld) next(turn conversations.Turn) Next {
	next, err := WhatNext(context.Background(), w.pool, w.company, turn.ConversationID, time.Now())
	if err != nil {
		w.t.Fatalf("WhatNext: %v", err)
	}
	return next
}

// The practice chat shows "ansa is writing..." only when ansa will answer:
// WhatNext reads the same gate and away settings as an answer.
func TestWhatNextFollowsTheGateAndTheAwaySettings(t *testing.T) {
	w := newReplyWorld(t, `{"kind":"reply","text":"We open at 18:00."}`)
	fresh := w.customerSays("an", "When do you open?")
	if got := w.next(fresh); got.What != NextAnswers {
		t.Fatalf("a fresh message: %+v", got)
	}
	w.answer(fresh)
	if got := w.next(fresh); got.What != NextNothing {
		t.Fatalf("answered already: %+v", got)
	}

	w.brainAnswer = `{"kind":"needs_person","reason":"complaint"}`
	complaint := w.customerSays("bo", "Cold pizza!")
	w.answer(complaint)
	if got := w.next(w.customerSays("bo", "Hello?")); got.What != NextRequestOpen {
		t.Fatalf("a request is open: %+v", got)
	}
	mustExec(t, w.pool, `UPDATE contacts SET important = true WHERE company_id = $1 AND external_id = 'bo'`, w.companyID)
	again := w.customerSays("bo", "Are you there?")
	if got := w.next(again); got.What != NextToldYou {
		t.Fatalf("an important person while their request is open: %+v", got)
	}
	w.answer(again)
	if got := w.next(again); got.What != NextToldYou {
		t.Fatalf("passed on to you: %+v", got)
	}
	important := w.customerSays("cy", "It's me")
	mustExec(t, w.pool, `UPDATE contacts SET important = true WHERE company_id = $1 AND external_id = 'cy'`, w.companyID)
	if got := w.next(important); got.What != NextAnswers {
		t.Fatalf("an important person is passed on at once: %+v", got)
	}

	mustExec(t, w.pool, `INSERT INTO assistant_settings (company_id, reply_mode) VALUES ($1, 'ask_first')`, w.companyID)
	w.brainAnswer = `{"kind":"reply","text":"We open at 18:00."}`
	drafted := w.customerSays("di", "When do you open?")
	w.answer(drafted)
	if got := w.next(drafted); got.What != NextDraft {
		t.Fatalf("Ask me first: %+v", got)
	}
	mustExec(t, w.pool, `UPDATE assistant_settings SET status = 'paused' WHERE company_id = $1`, w.companyID)
	if got := w.next(w.customerSays("di", "Hello?")); got.What != NextPaused {
		t.Fatalf("paused: %+v", got)
	}
}

// "Only when I'm away" while you're available: ansa waits for you until its
// time (said before and after its run sets the wait), or leaves it to you.
func TestWhatNextSaysWhenAnsaAnswersWhileYoureAvailable(t *testing.T) {
	w := newReplyWorld(t, `{"kind":"reply","text":"They'll be back soon."}`)
	mustExec(t, w.pool, `INSERT INTO assistant_settings (company_id, answer_when, reply_grace_minutes) VALUES ($1, 'when_away', 10)`, w.companyID)
	turn := w.customerSays("ed", "Are you there?")
	before := w.next(turn)
	if before.What != NextAnswersAt || before.At == nil || time.Until(*before.At) < 9*time.Minute || time.Until(*before.At) > 11*time.Minute {
		t.Fatalf("before the run: %+v", before)
	}
	w.answer(turn)
	var due time.Time
	w.pool.QueryRow(context.Background(), `SELECT assistant_due_at FROM conversations WHERE company_id = $1 AND id = $2`, w.companyID, turn.ConversationID).Scan(&due)
	if after := w.next(turn); after.What != NextAnswersAt || after.At == nil || !after.At.Equal(due) {
		t.Fatalf("after the run: %+v, due %v", after, due)
	}
	mustExec(t, w.pool, `UPDATE assistant_settings SET reply_grace_minutes = NULL WHERE company_id = $1`, w.companyID)
	if got := w.next(w.customerSays("fi", "Hi")); got.What != NextYouAnswer {
		t.Fatalf("no minutes to wait: %+v", got)
	}
	owner := database.TestOwner(t, w.pool, w.companyID)
	mustExec(t, w.pool, `UPDATE conversations SET handled_by = 'person', taken_over_by_user_id = $2, taken_over_at = now() WHERE company_id = $1`, w.companyID, owner)
	if got := w.next(turn); got.What != NextTakenOver {
		t.Fatalf("taken over: %+v", got)
	}
}
