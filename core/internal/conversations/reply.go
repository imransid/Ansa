package conversations

import (
	"context"
	"errors"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/jobs"
)

// ReplyJobKind is the assistant's job for a customer's message (handled by
// core/internal/assistant).
const ReplyJobKind = "assistant.reply"

// ReplySettle: customers often send a few messages in a row, so the answer
// starts a moment later and one answer covers them all (an older message's
// run then stays quiet).
const ReplySettle = 1500 * time.Millisecond

// QueueReply asks the assistant to answer this customer message, once.
func QueueReply(ctx context.Context, pool *database.Pool, turn *Turn) error {
	payload := map[string]string{"conversationId": turn.ConversationID, "triggerMessageId": turn.TriggerMessageID}
	job := jobs.NewJob{Kind: ReplyJobKind, Payload: payload, RunAfter: time.Now().Add(ReplySettle), DedupeKey: "reply:" + turn.TriggerMessageID}
	_, err := jobs.Enqueue(ctx, pool, turn.CompanyID, job)
	if errors.Is(err, jobs.ErrDuplicate) {
		return nil
	}
	return err
}
