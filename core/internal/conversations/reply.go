package conversations

import (
	"context"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/jobs"
	"ansa/core/internal/tenant"
)

// ReplyJobKind is the assistant's job for a customer's message (handled by
// core/internal/assistant).
const ReplyJobKind = "assistant.reply"

// ReplySettle: customers often send a few messages in a row, so the answer
// starts a moment later and one answer covers them all (an older message's
// run then stays quiet).
const ReplySettle = 1500 * time.Millisecond

// queueReplyWithin asks the assistant to answer this customer message, in
// the transaction that saves it: a failure can never leave a saved message
// with no answer coming (the platform's retry would find it saved and
// stop). One job per new message, so it needs no dedupe key.
func queueReplyWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, conversationID, triggerMessageID string) error {
	payload := map[string]string{"conversationId": conversationID, "triggerMessageId": triggerMessageID}
	job := jobs.NewJob{Kind: ReplyJobKind, Payload: payload, RunAfter: time.Now().Add(ReplySettle)}
	_, err := jobs.EnqueueWithin(ctx, tx, company, job)
	return err
}
