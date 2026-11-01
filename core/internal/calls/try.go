package calls

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/tenant"
)

// ErrNoSuchCall: the company has no call with that id.
var ErrNoSuchCall = errors.New("calls: the company has no such call")

// Tried is what the brain would decide about a stored call (the
// development tool `go run ./cmd/simulate try-brain`): codes and names
// only, never the transcript or the AI's own words.
type Tried struct {
	Outcome, Source, ReasonCode, Category, Model, ErrorClass string
}

// TryDecision asks the brain about one of the company's stored calls
// exactly as the analysis does (the same request, the same checks of its
// answer) and returns the decision WITHOUT claiming the call or saving
// anything: a dry run. Like the analysis, it may make one paid model call.
func (a *Analyzer) TryDecision(ctx context.Context, company tenant.CompanyID, callID string) (Tried, error) {
	const statement = `SELECT vapi_call_id, caller_number, ended_reason, transcript_encrypted FROM calls WHERE company_id = $1 AND id = $2`
	var c claimedCall
	err := a.Pool.QueryRow(ctx, statement, company.String(), callID).Scan(&c.vapiCallID, &c.callerNumber, &c.endedReason, &c.transcriptEncrypted)
	if errors.Is(err, pgx.ErrNoRows) {
		return Tried{}, ErrNoSuchCall
	}
	if err != nil {
		return Tried{}, err
	}
	d, _, err := a.decide(ctx, company, c)
	if err != nil {
		return Tried{}, err
	}
	tried := Tried{Outcome: d.Outcome, Source: d.Source, ReasonCode: d.ReasonCode, Model: d.Model}
	if d.Category != nil {
		tried.Category = *d.Category
	}
	if d.ReasonCode == "model_error" {
		tried.ErrorClass = safeErrorClass(d.ErrorName)
	}
	return tried, nil
}
