package assistant

import (
	"context"
	"errors"

	"ansa/core/internal/chat"
	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/jobs"
	"ansa/core/internal/orders"
	"ansa/core/internal/team"
)

// OrderAlertJobKind tells the owners a customer placed an order.
const OrderAlertJobKind = "order.alert"

// OrderAlertPayload names the placed order.
type OrderAlertPayload struct {
	OrderID string `json:"orderId"`
}

// runOrderStep does what orders.PlanStep plans for the AI's order answer
// (the old services/assistant-order.ts): ansa's own question or summary goes
// out like a reply (waiting in Ask me first), the customer's yes places the
// order, their no takes it back. The AI's words are never sent here.
func (r *Runner) runOrderStep(ctx context.Context, turn conversations.Turn, info conversationInfo, inputs *Inputs, decision Decision) (string, error) {
	step := orders.PlanStep(decision.Kind, decision.Order, inputs.Ordering, inputs.Kind)
	switch step.Kind {
	case orders.StepHandover:
		return OutcomeHandedOver, r.handOver(ctx, turn, info, inputs, Handover{Reason: step.Reason, SendHoldingReply: true})
	case orders.StepAsk:
		return r.sendOrDraft(ctx, turn, info, inputs, step.Text, nil)
	case orders.StepPropose:
		proposal, err := r.encryptedProposal(turn, step.Order)
		if err != nil {
			return "", err
		}
		return r.sendOrDraft(ctx, turn, info, inputs, step.Text, proposal)
	case orders.StepWithdraw:
		return r.withdraw(ctx, turn, info, inputs)
	}
	return r.place(ctx, turn, info, inputs)
}

// encryptedProposal gives the order a new id and encrypts its address and notes for it.
func (r *Runner) encryptedProposal(turn conversations.Turn, order orders.Priced) (*orders.Proposal, error) {
	id, err := conversations.NewID()
	if err != nil {
		return nil, err
	}
	proposal := &orders.Proposal{OrderID: id, Order: order}
	if order.Fulfilment == "delivery" {
		address, err := r.Box.Encrypt(order.Address, orders.FieldContext(turn.CompanyID, id, "address"))
		if err != nil {
			return nil, err
		}
		proposal.AddressEncrypted = &address
	}
	if order.Notes != "" {
		notes, err := r.Box.Encrypt(order.Notes, orders.FieldContext(turn.CompanyID, id, "notes"))
		if err != nil {
			return nil, err
		}
		proposal.NotesEncrypted = &notes
	}
	return proposal, nil
}

// withdraw: the customer doesn't want the order after all. It goes, and
// ansa's fixed answer is sent at once, in one transaction that checks the
// conversation again.
func (r *Runner) withdraw(ctx context.Context, turn conversations.Turn, info conversationInfo, inputs *Inputs) (string, error) {
	return r.saveFixedAndSend(ctx, turn, info, inputs, false, func(tx database.Tx, messageID string) (string, string, error) {
		err := orders.DeleteProposalWithin(ctx, tx, turn.CompanyID, turn.ConversationID)
		return orders.WithdrawnText, "replied", err
	})
}

// place: the customer's yes. The order whose summary reached them gets the
// company's next number (the company row lock first), ansa's confirmation
// goes at once, and the owners are alerted (a job, saved with the order).
// Nothing to say yes to = a person.
func (r *Runner) place(ctx context.Context, turn conversations.Turn, info conversationInfo, inputs *Inputs) (string, error) {
	outcome, err := r.saveFixedAndSend(ctx, turn, info, inputs, true, func(tx database.Tx, messageID string) (string, string, error) {
		placed, err := orders.PlaceWithin(ctx, tx, turn.CompanyID, turn.ConversationID)
		if err != nil || placed == nil {
			return "", "", err
		}
		alert := jobs.NewJob{Kind: OrderAlertJobKind, Payload: OrderAlertPayload{OrderID: placed.OrderID}, DedupeKey: "order:" + placed.OrderID}
		if _, err := jobs.EnqueueWithin(ctx, tx, turn.CompanyID, alert); err != nil && !errors.Is(err, jobs.ErrDuplicate) {
			return "", "", err
		}
		if inputs.Spoken {
			return orders.SpokenPlacedText(placed.Number), "order_placed", nil
		}
		return orders.PlacedText(placed.Number), "order_placed", nil
	})
	if err == nil && outcome == outcomeNothingToDo {
		return OutcomeHandedOver, r.handOver(ctx, turn, info, inputs, Handover{Reason: "order_unclear", SendHoldingReply: true})
	}
	return outcome, err
}

// outcomeNothingToDo: the step found nothing to do (no proposal to say yes to).
const outcomeNothingToDo = "nothing-to-save"

// saveFixedAndSend saves one of ansa's fixed order messages ("sending":
// they never wait for a person) with the step's own writes, in ONE
// transaction that checks the conversation again (placing takes the
// company row lock first). `write` returns the text and the activity line,
// or "" when there is nothing to do. Then the message is sent.
func (r *Runner) saveFixedAndSend(ctx context.Context, turn conversations.Turn, info conversationInfo, inputs *Inputs, lockCompany bool,
	write func(tx database.Tx, messageID string) (text, activity string, err error)) (string, error) {
	messageID, err := conversations.NewID()
	if err != nil {
		return "", err
	}
	outcome, text := OutcomeQuiet, ""
	cannotSend := false
	var target chat.Target
	err = database.InTx(ctx, r.Pool, func(tx database.Tx) error {
		if lockCompany {
			if err := team.LockCompanyWithin(ctx, tx, turn.CompanyID); err != nil {
				return err
			}
		}
		gate, err := GateWithin(ctx, tx, turn, GateOptions{RequireNewest: true, Lock: true, OnACall: inputs.Spoken})
		if err != nil || gate != GateMay {
			return err
		}
		var refusal string
		if target, refusal, err = routeWithin(ctx, tx, turn, inputs); err != nil || refusal != "" {
			cannotSend = refusal != ""
			return err
		}
		var activity string
		if text, activity, err = write(tx, messageID); err != nil || text == "" {
			outcome = outcomeNothingToDo
			return err
		}
		body, err := r.Box.Encrypt(text, conversations.MessageContext(turn.CompanyID, messageID))
		if err != nil {
			return err
		}
		if err := insertOutgoing(ctx, tx, turn, messageID, body, "sending"); err != nil {
			return err
		}
		if err := MarkHandledWithin(ctx, tx, turn); err != nil {
			return err
		}
		if err := recordActivity(ctx, tx, turn, activity, ""); err != nil {
			return err
		}
		outcome = OutcomeReplied
		return touchWithin(ctx, tx, turn)
	})
	switch {
	case err != nil:
		return "", err
	case cannotSend:
		return OutcomeHandedOver, r.handOver(ctx, turn, info, inputs, Handover{Reason: "send_failed"})
	case outcome != OutcomeReplied:
		return outcome, nil
	}
	return OutcomeReplied, r.deliver(ctx, turn, info, inputs, target, messageID, text)
}
