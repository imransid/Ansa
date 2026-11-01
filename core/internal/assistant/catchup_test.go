package assistant

import (
	"context"
	"encoding/json"
	"testing"

	"ansa/core/internal/conversations"
)

func TestTheCatchUpAnswersOnlyWhatNobodyAnswered(t *testing.T) {
	w := newReplyWorld(t, `{"kind":"reply","text":"They'll be back soon."}`)
	ctx := context.Background()
	mustExec(t, w.pool, `INSERT INTO assistant_settings (company_id, answer_when, reply_grace_minutes) VALUES ($1, 'when_away', 5)`, w.companyID)
	waiting := w.customerSays("ja", "Hello?")
	answered := w.customerSays("ka", "Hello?")
	if w.answer(waiting) != OutcomeWaiting || w.answer(answered) != OutcomeWaiting {
		t.Fatal("both wait for the person first")
	}
	personID, _ := conversations.NewID()
	mustExec(t, w.pool, `INSERT INTO messages (id, company_id, conversation_id, direction, author, body_encrypted, send_status) VALUES ($1, $2, $3, 'out', 'business_account', 'v1:x:y:z', 'sent')`, personID, w.companyID, answered.ConversationID)
	mustExec(t, w.pool, `UPDATE conversations SET assistant_due_at = now() - interval '1 second' WHERE company_id = $1`, w.companyID)
	queued, err := queueDueRepliesOf(ctx, w.pool, w.companyID)
	if err != nil || queued != 1 {
		t.Fatalf("queued %d (%v): only the one nobody answered", queued, err)
	}
	if w.count(`SELECT count(*) FROM conversations WHERE company_id = $1 AND assistant_due_at IS NOT NULL`, w.companyID) != 0 {
		t.Fatal("both are claimed (their due time cleared)")
	}
	var payload []byte
	w.pool.QueryRow(ctx, `SELECT payload FROM core_jobs WHERE company_id = $1 AND kind = $2`, w.companyID, ReplyJobKind).Scan(&payload)
	var job replyPayload
	json.Unmarshal(payload, &job)
	if job.TriggerMessageID != waiting.TriggerMessageID || !job.CoverAfterNoReply {
		t.Fatalf("the job answers the waiting message whatever the away settings: %s", payload)
	}
	if again, _ := queueDueRepliesOf(ctx, w.pool, w.companyID); again != 0 {
		t.Fatal("a claimed conversation is never queued twice")
	}
}
