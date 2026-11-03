package assistant

import (
	"context"

	"ansa/core/internal/plaintext"
	"ansa/core/internal/tenant"
)

// What the brain reads to write a call's note (call_summary.go).

// callSummaryRequest matches the brain's CallSummaryRequest
// (brain/brain/assistant/call_summary.py): never an id.
type callSummaryRequest struct {
	Kind         string  `json:"kind"`
	Name         string  `json:"name"`
	Conversation []Line  `json:"conversation"`
	CallerName   *string `json:"caller_name"`
	OrdersPlaced []int   `json:"orders_placed"`
	Engine       string  `json:"engine"`
	APIKey       *string `json:"api_key"`
}

// callSummaryRequest is the brain's slice for a call's note: who ansa
// answered for, the call's lines, who called, the orders it placed and the
// company's AI engine; nil when the business's own key can't be read.
func (r *Runner) callSummaryRequest(ctx context.Context, company tenant.CompanyID, call *finishedCall) (*callSummaryRequest, error) {
	settings, err := readSettings(ctx, r.Pool, company)
	if err != nil {
		return nil, err
	}
	kind, name, err := ReadCallVoice(ctx, r.Pool, company)
	if err != nil {
		return nil, err
	}
	// Never null: the brain wants a list (a null refuses the whole note).
	ordersPlaced := append([]int{}, call.OrdersPlaced...)
	request := &callSummaryRequest{Kind: kind, Name: name, Conversation: call.Lines, CallerName: callerNameForBrain(call.CallerName),
		OrdersPlaced: ordersPlaced, Engine: settings.AIEngine}
	if settings.AIEngine == "api_key" && settings.KeyEncrypted != nil {
		key, err := r.Box.Decrypt(*settings.KeyEncrypted, KeyContext(company))
		if err != nil {
			return nil, nil
		}
		request.APIKey = &key
	}
	return request, nil
}

// callerNameForBrain is the line's name for the caller as one plain line
// within the brain's 200 characters (nil = none).
func callerNameForBrain(name *string) *string {
	if name == nil {
		return nil
	}
	cleaned := cutRunes(plaintext.SingleLine(*name), 200)
	if cleaned == "" {
		return nil
	}
	return &cleaned
}
