package comments

import (
	"context"
	"encoding/json"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/jobs"
	"ansa/core/internal/tenant"
)

// "Ask me first": the AI's own texts wait (an order's note with its private
// message: it announces it); a person's Send sends them through the job, once;
// Discard sends nothing. ansa's fixed texts and holding replies never wait.
func TestAskMeFirstWaitsForSendOrDiscard(t *testing.T) {
	w := newCommentWorld(t)
	ctx := context.Background()
	w.must(`UPDATE assistant_settings SET reply_mode = 'ask_first' WHERE company_id = $1`, w.company.String())
	question := w.comment("a-1", "lena", "Open on Friday?")
	w.brainSays("question", map[string]string{"public_reply": "Yes, every day, Friday too!"})
	w.answer(question)
	order := w.comment("a-2", "marco", "Price?")
	w.brainSays("order", map[string]string{"private_message": "Kacchi Biryani is BDT 450. Order right here!"})
	w.answer(order)
	complaint := w.comment("a-3", "sara", "Rude staff!")
	w.brainSays("complaint", map[string]string{"subject": "Rude staff", "summary": "Sara says the staff were rude."})
	w.answer(complaint)
	if q, o := w.view(question), w.view(order); q.Status != StatusWaiting || q.PublicReply.Status != PartWaiting || o.Status != StatusWaiting ||
		o.PublicReply.Status != PartWaiting || o.PrivateMessage.Status != PartWaiting {
		t.Fatalf("the AI's own texts wait: %+v %+v", q, o)
	}
	if c := w.view(complaint); c.Status != StatusAnswered || len(w.written()) != 2 {
		t.Fatalf("a holding reply never waits: %+v %v", c, w.written())
	}

	if outcome, err := SendWaiting(ctx, w.pool, w.company, w.owner, question); err != nil || outcome != OutcomeSent {
		t.Fatalf("send: %s %v", outcome, err)
	}
	if outcome, _ := SendWaiting(ctx, w.pool, w.company, w.owner, question); outcome != OutcomeChanged {
		t.Fatal("a second press finds it no longer waiting")
	}
	if w.view(question).Status != StatusNew {
		t.Fatal("being sent")
	}
	w.runQueuedJob(question)
	if view := w.view(question); view.Status != StatusAnswered || view.PublicReply.Status != PartSent || w.written()["facebook-comment:a-1"] != "Yes, every day, Friday too!" {
		t.Fatalf("sent as the AI wrote it: %+v", view)
	}

	if outcome, _ := DiscardWaiting(ctx, w.pool, w.company, w.owner, order); outcome != OutcomeDiscarded {
		t.Fatal("discarded")
	}
	if view := w.view(order); view.Status != StatusSkipped || view.SkipReason != SkipDiscarded || view.PublicReply != nil || view.PrivateMessage != nil {
		t.Fatalf("nothing went: shown as skipped: %+v", view)
	}
	stranger := database.TestOwner(t, w.pool, database.TestCompany(t, w.pool))
	if outcome, _ := SendWaiting(ctx, w.pool, w.company, stranger, question); outcome != OutcomeNotAllowed {
		t.Fatal("someone of another company can't")
	}
	other, _ := tenant.FromTrustedSource(database.TestCompany(t, w.pool))
	otherOwner := database.TestOwner(t, w.pool, other.String())
	if outcome, _ := DiscardWaiting(ctx, w.pool, other, otherOwner, question); outcome != OutcomeChanged {
		t.Fatal("another company's comment is never theirs to discard")
	}
}

// runQueuedJob runs the comment's queued answering job, as core's worker does.
func (w *commentWorld) runQueuedJob(commentRowID string) {
	var job jobs.Job
	err := w.pool.QueryRow(context.Background(), `SELECT id, payload FROM core_jobs WHERE company_id = $1 AND kind = $2 AND payload->>'commentId' = $3 AND status = 'queued'
		ORDER BY created_at DESC LIMIT 1`, w.company.String(), AnswerJobKind, commentRowID).Scan(&job.ID, &job.Payload)
	if err != nil {
		w.t.Fatalf("the queued job: %v", err)
	}
	job.CompanyID = w.company
	var p payload
	if json.Unmarshal(job.Payload, &p) != nil || p.CommentID != commentRowID {
		w.t.Fatal("the job names the comment only")
	}
	if err := w.answerer.HandleJob(context.Background(), &job); err != nil {
		w.t.Fatalf("HandleJob: %v", err)
	}
}
