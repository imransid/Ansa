package assistant

import (
	"context"
	"time"

	"ansa/core/internal/orders"
	"ansa/core/internal/tenant"
)

// TryResult is what the assistant would do with a customer's first message.
type TryResult struct {
	// "reply", "handover" or "no_reply".
	Outcome string `json:"outcome"`
	// The reply as the customer would get it (with the AI label), or the holding reply.
	Text string `json:"text"`
	// Why a person would be asked, in words.
	Why string `json:"why"`
}

// Try is "Try your assistant" (the old services/assistant-test.ts): what
// the assistant would answer this message as a customer's first, with the
// same slice, AI engine and checks as a real reply. Nothing is saved, sent
// or alerted. An order shows what ansa itself would send; a "yes" with no
// order waiting goes to a person, as it would in a chat.
func (r *Runner) Try(ctx context.Context, company tenant.CompanyID, text string) (TryResult, error) {
	inputs, err := GatherInputs(ctx, r.Pool, r.Box, company, "", time.Now())
	if err != nil {
		return TryResult{}, err
	}
	inputs.Request.Conversation = []Line{{Sender: "customer", Text: text}}
	decision := r.decide(ctx, inputs)
	label := func(text string) string { return WithAILabel(text, inputs.Name, inputs.Kind, true) }
	switch decision.Kind {
	case "reply":
		return TryResult{Outcome: "reply", Text: label(decision.Text)}, nil
	case "no_reply":
		return TryResult{Outcome: "no_reply"}, nil
	case "order_summary", "order_confirmed", "order_withdrawn":
		step := orders.PlanStep(decision.Kind, decision.Order, inputs.Ordering, inputs.Kind)
		switch step.Kind {
		case orders.StepHandover:
			decision.Reason = step.Reason
		case orders.StepPlace:
			decision.Reason = "order_unclear"
		default:
			return TryResult{Outcome: "reply", Text: label(step.Text)}, nil
		}
	case "needs_person":
		decision.Reason = handoverFor(decision, inputs).Reason
	}
	return TryResult{Outcome: "handover", Text: label(inputs.HoldingReply), Why: ReasonText[decision.Reason]}, nil
}
