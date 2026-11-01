package assistant

import (
	"context"

	"ansa/core/internal/chat"
	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
)

// sendOrDraft saves the checked reply, with the AI label when it is the
// first automated message: "sending" (Automatic) or a "draft" that waits for
// a person (Ask me first; a draft waiting before is discarded), in ONE
// transaction that checks everything again. Then it sends. A reply that
// can't go asks a person (no holding reply: the channel refused one).
func (r *Runner) sendOrDraft(ctx context.Context, turn conversations.Turn, info conversationInfo, inputs *Inputs, reply string) (string, error) {
	text := WithAILabel(reply, inputs.Name, inputs.Kind, info.FirstAutomated)
	messageID, err := conversations.NewID()
	if err != nil {
		return "", err
	}
	body, err := r.Box.Encrypt(text, conversations.MessageContext(turn.CompanyID, messageID))
	if err != nil {
		return "", err
	}
	waitForPerson := inputs.ReplyMode == "ask_first"
	outcome := OutcomeQuiet
	cannotSend := false
	var target chat.Target
	err = database.InTx(ctx, r.Pool, func(tx database.Tx) error {
		gate, err := GateWithin(ctx, tx, turn, GateOptions{RequireNewest: true, Lock: true})
		if err != nil || gate != GateMay {
			return err
		}
		status, action := "draft", "drafted"
		if !waitForPerson {
			status, action = "sending", "replied"
			var refusal string
			if target, refusal, err = chat.RouteWithin(ctx, tx, turn.CompanyID, turn.ConversationID); err != nil || refusal != "" {
				cannotSend = refusal != ""
				return err
			}
		}
		if err := discardWaitingDraftsWithin(ctx, tx, turn); err != nil {
			return err
		}
		if err := insertOutgoing(ctx, tx, turn, messageID, body, status); err != nil {
			return err
		}
		if err := MarkHandledWithin(ctx, tx, turn); err != nil {
			return err
		}
		if err := recordActivity(ctx, tx, turn, action, ""); err != nil {
			return err
		}
		outcome = map[string]string{"draft": OutcomeDrafted, "sending": OutcomeReplied}[status]
		return touchWithin(ctx, tx, turn)
	})
	if err != nil {
		return "", err
	}
	if cannotSend {
		return OutcomeHandedOver, r.handOver(ctx, turn, info, inputs, Handover{Reason: "send_failed"})
	}
	if outcome != OutcomeReplied {
		return outcome, nil
	}
	result := r.Chat.Send(ctx, target, messageID, text)
	if err := chat.RecordDelivery(ctx, r.Pool, turn.CompanyID, messageID, result); err != nil {
		return "", err
	}
	if result.Status == "failed" {
		return OutcomeReplied, r.handOver(ctx, turn, info, inputs, Handover{Reason: "send_failed"})
	}
	return OutcomeReplied, nil
}
