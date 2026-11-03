package assistant

import (
	"context"
	"time"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
)

// Someone the owner marked important (step 51) always reaches them: ansa
// never answers them with the AI.

// handOverImportant hands an important person's message to you: the
// holding reply, a request and the owners' alert, without the AI.
func (r *Runner) handOverImportant(ctx context.Context, turn conversations.Turn, info conversationInfo) error {
	inputs, err := GatherInputs(ctx, r.Pool, r.Box, turn.CompanyID, turn.ConversationID, r.now())
	if err != nil {
		return err
	}
	return r.handOver(ctx, turn, info, inputs, Handover{Reason: "important_person", SendHoldingReply: true})
}

// tellAgainAboutImportant: someone you marked important wrote again while
// their request is still open. ansa stays quiet then (one holding reply
// until a person answers), but they always reach you: a "handed_over" line
// and the owners' alert again, at once, for this message, without a second
// holding reply or request. Only for their newest message (a burst tells
// you once), in ONE transaction that checks the gate again.
func (r *Runner) tellAgainAboutImportant(ctx context.Context, turn conversations.Turn) (string, error) {
	outcome := OutcomeQuiet
	err := database.InTx(ctx, r.Pool, func(tx database.Tx) error {
		gate, err := GateWithin(ctx, tx, turn, GateOptions{Lock: true})
		if err != nil || gate != GateNeedsPerson {
			return err
		}
		newest, err := isNewestCustomerMessageWithin(ctx, tx, turn)
		if err != nil || !newest {
			return err
		}
		if err := recordActivity(ctx, tx, turn, "handed_over", "important_person"); err != nil {
			return err
		}
		if err := MarkHandledWithin(ctx, tx, turn); err != nil {
			return err
		}
		if err := touchWithin(ctx, tx, turn); err != nil {
			return err
		}
		outcome = OutcomeToldAgain
		payload := AlertPayload{ConversationID: turn.ConversationID, Reason: "important_person", WroteAgain: true}
		return queueAlertJob(ctx, tx, turn, payload, time.Now())
	})
	return outcome, err
}
