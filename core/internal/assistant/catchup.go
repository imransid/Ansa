package assistant

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/jobs"
	"ansa/core/internal/tenant"
)

// At most this many conversations per catch-up round (the next round takes the rest).
const catchUpBatch = 50

// QueueDueReplies is the catch-up for "if I haven't answered within N
// minutes" (the old services/assistant-due.ts): it takes the conversations
// whose minutes are up, of every company, and queues the assistant's answer
// to the newest message, unless you answered it yourself meanwhile (in ansa
// or in your own Telegram app). Returns how many it queued.
func QueueDueReplies(ctx context.Context, pool *database.Pool) (int, error) {
	return queueDueRepliesOf(ctx, pool, "")
}

// queueDueRepliesOf: onlyCompany "" = every company; the tests pass their
// own (they share the local database with the developer's data).
func queueDueRepliesOf(ctx context.Context, pool *database.Pool, onlyCompany string) (int, error) {
	queued := 0
	for range catchUpBatch {
		found := false
		err := database.InTx(ctx, pool, func(tx database.Tx) error {
			turn, err := claimDueWithin(ctx, tx, onlyCompany)
			if err != nil || turn == nil {
				return err
			}
			found = true
			if turn.TriggerMessageID == "" {
				return nil
			}
			payload := replyPayload{ConversationID: turn.ConversationID, TriggerMessageID: turn.TriggerMessageID, CoverAfterNoReply: true}
			_, err = jobs.EnqueueWithin(ctx, tx, turn.CompanyID, jobs.NewJob{Kind: ReplyJobKind, Payload: payload, DedupeKey: "catchup:" + turn.TriggerMessageID})
			if errors.Is(err, jobs.ErrDuplicate) {
				return nil
			}
			queued++
			return err
		})
		if err != nil || !found {
			return queued, err
		}
	}
	return queued, nil
}

// claimDueWithin claims one due conversation (its due time cleared in ONE
// UPDATE: two rounds never take the same one) and finds the message to
// answer: the customer's newest, unless a person or the business's own app
// answered after it (then TriggerMessageID is ""). nil: none is due.
func claimDueWithin(ctx context.Context, tx database.Tx, onlyCompany string) (*conversations.Turn, error) {
	const claim = `
		-- cross-company: the catch-up serves every company; the claimed row's own company is used after.
		UPDATE conversations SET assistant_due_at = NULL
		WHERE id = (
			SELECT id FROM conversations
			WHERE assistant_due_at <= now() AND ($1 = '' OR company_id::text = $1)
			ORDER BY assistant_due_at
			FOR UPDATE SKIP LOCKED
			LIMIT 1
		) AND assistant_due_at <= now()
		RETURNING company_id, id`
	var companyText, conversationID string
	err := tx.QueryRow(ctx, claim, onlyCompany).Scan(&companyText, &conversationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	company, err := tenant.FromTrustedSource(companyText)
	if err != nil {
		return nil, err
	}
	turn := &conversations.Turn{CompanyID: company, ConversationID: conversationID}
	turn.TriggerMessageID, err = unansweredNewestWithin(ctx, tx, company, conversationID)
	return turn, err
}

// unansweredNewestWithin is the customer's newest message, or "" when there
// is none or someone answered after it.
func unansweredNewestWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, conversationID string) (string, error) {
	const statement = `
		SELECT newest.id FROM (
			SELECT id, created_at FROM messages
			WHERE company_id = $1 AND conversation_id = $2 AND direction = 'in' AND body_encrypted IS NOT NULL
			ORDER BY created_at DESC LIMIT 1
		) AS newest
		WHERE NOT EXISTS (
			SELECT 1 FROM messages
			WHERE company_id = $1 AND conversation_id = $2 AND author IN ('person', 'business_account') AND created_at > newest.created_at
		)`
	var id string
	err := tx.QueryRow(ctx, statement, company.String(), conversationID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}
