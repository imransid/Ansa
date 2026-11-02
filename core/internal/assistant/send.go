package assistant

import (
	"context"

	"ansa/core/internal/chat"
	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/orders"
)

// sendOrDraft saves the checked reply (or ansa's own order question or
// summary), with the AI label when it is the first automated message:
// "sending" (Automatic) or a "draft" that waits for a person (Ask me first;
// a draft waiting before is discarded), in ONE transaction that checks
// everything again, with the order a summary describes. Then it sends. A
// reply that can't go asks a person (no holding reply: the channel refused one).
func (r *Runner) sendOrDraft(ctx context.Context, turn conversations.Turn, info conversationInfo, inputs *Inputs, reply string, proposal *orders.Proposal) (string, error) {
	text := WithAILabel(reply, inputs.Name, inputs.Kind, info.FirstAutomated)
	messageID, err := conversations.NewID()
	if err != nil {
		return "", err
	}
	body, err := r.Box.Encrypt(text, conversations.MessageContext(turn.CompanyID, messageID))
	if err != nil {
		return "", err
	}
	// A caller on the line can't wait for a person's approval.
	waitForPerson := inputs.ReplyMode == "ask_first" && !inputs.Spoken
	outcome := OutcomeQuiet
	cannotSend := false
	var target chat.Target
	err = database.InTx(ctx, r.Pool, func(tx database.Tx) error {
		gate, err := GateWithin(ctx, tx, turn, GateOptions{RequireNewest: true, Lock: true, OnACall: inputs.Spoken})
		if err != nil || gate != GateMay {
			return err
		}
		status, action := "draft", "drafted"
		if !waitForPerson {
			status, action = "sending", "replied"
			var refusal string
			if target, refusal, err = routeWithin(ctx, tx, turn, inputs); err != nil || refusal != "" {
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
		if proposal != nil {
			if err := orders.SaveProposalWithin(ctx, tx, turn.CompanyID, turn.ConversationID, messageID, *proposal); err != nil {
				return err
			}
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
	return OutcomeReplied, r.deliver(ctx, turn, info, inputs, target, messageID, text)
}

// routeWithin is where the assistant's words go: on a live call they are
// spoken (the phone line reads them back from the conversation); otherwise
// the chat's own route, checked in this transaction.
func routeWithin(ctx context.Context, tx database.Tx, turn conversations.Turn, inputs *Inputs) (chat.Target, string, error) {
	if inputs.Spoken {
		return chat.Target{CompanyID: turn.CompanyID, Channel: conversations.ChannelPhone}, "", nil
	}
	return chat.RouteWithin(ctx, tx, turn.CompanyID, turn.ConversationID)
}

// deliver sends a saved message and records what became of it; one the
// channel refused asks a person (no holding reply: it would be refused too).
func (r *Runner) deliver(ctx context.Context, turn conversations.Turn, info conversationInfo, inputs *Inputs, target chat.Target, messageID, text string) error {
	result := r.Chat.Send(ctx, target, messageID, text)
	if err := chat.RecordDelivery(ctx, r.Pool, turn.CompanyID, messageID, result); err != nil {
		return err
	}
	if result.Status == "failed" {
		return r.handOver(ctx, turn, info, inputs, Handover{Reason: "send_failed"})
	}
	return nil
}
