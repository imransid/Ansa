package calls

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/jobs"
	"ansa/core/internal/logging"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
	"ansa/core/internal/tickets"
)

// LOGGING RULE for this file: never the transcript, the brain's answer or
// an error's message. Fixed lines and class names only.

// An analysis started this long ago is dead and may be redone; a call not
// decided this long after it was saved is "stuck" on the Calls page.
const staleAnalysisMinutes = 5

// Used when the decision came from a rule, or the AI gave no subject.
const fallbackSubject = "Phone call needs follow-up"

// Analyzer decides saved calls: solved (with the customer's own confirming
// sentence, checked by the brain) or a request for a person.
type Analyzer struct {
	Pool  *database.Pool
	Box   *secure.Box
	Brain *brainclient.Client
	Log   *logging.Logger
}

// decision is the brain's answer (brain/brain/calls/decision.py).
type decision struct {
	Outcome            string  `json:"outcome"`
	Source             string  `json:"source"`
	ReasonCode         string  `json:"reason_code"`
	CustomerIssue      *string `json:"customer_issue"`
	Explanation        *string `json:"explanation"`
	TicketSubject      *string `json:"ticket_subject"`
	Category           *string `json:"category"`
	ResolutionEvidence *string `json:"resolution_evidence"`
	ErrorName          string  `json:"error_name"`
	Model              string  `json:"model"`
}

// What a decision's sources and outcomes may be (the columns' enums).
var (
	knownOutcomes  = map[string]bool{"solved": true, "needs_human": true}
	knownSources   = map[string]bool{"rule": true, "model": true}
	errorClassName = regexp.MustCompile(`^[A-Za-z0-9_]{1,64}$`)
)

// HandleJob runs the "call.analyze" job.
func (a *Analyzer) HandleJob(ctx context.Context, job *jobs.Job) error {
	var payload AnalyzePayload
	if json.Unmarshal(job.Payload, &payload) != nil || payload.CallID == "" {
		return &jobs.Failure{Code: "bad_payload", Permanent: true}
	}
	outcome, err := a.Analyze(ctx, job.CompanyID, payload.CallID)
	if err != nil {
		return err
	}
	if outcome == "failed" {
		return &jobs.Failure{Code: "analysis_failed"}
	}
	return nil
}

// Analyze claims one call of the company, asks the brain and saves the
// decision with a "needs_human"'s request in ONE transaction. Returns
// "decided", "not-claimed" (decided already, being analyzed, or not this
// company's) or "failed" (not even the fallback escalation could be saved;
// the call is analyzed again once its claim is stale).
func (a *Analyzer) Analyze(ctx context.Context, company tenant.CompanyID, callID string) (string, error) {
	call, claimed, err := a.claim(ctx, company, callID)
	if err != nil || !claimed {
		return "not-claimed", err
	}
	d, categories, err := a.decide(ctx, company, call)
	if err == nil {
		err = a.save(ctx, company, callID, call.callerNumber, d, categories)
	}
	if err == nil {
		return "decided", nil
	}
	a.Log.Error("call analysis failed", logging.ErrorType(err))
	fallback := decision{Outcome: "needs_human", Source: "rule", ReasonCode: "analysis_error"}
	if err := a.save(ctx, company, callID, call.callerNumber, fallback, nil); err != nil {
		a.Log.Error("call analysis fallback failed", logging.ErrorType(err))
		return "failed", nil
	}
	return "decided", nil
}

type claimedCall struct {
	vapiCallID                                     string
	callerNumber, endedReason, transcriptEncrypted *string
}

// claim marks the call "analyzing" in ONE UPDATE (pending, or analyzing
// for 5+ minutes), so a call is never sent to the brain twice at once.
func (a *Analyzer) claim(ctx context.Context, company tenant.CompanyID, callID string) (claimedCall, bool, error) {
	const statement = `
		UPDATE calls SET analysis_status = 'analyzing', analysis_started_at = now(), updated_at = now()
		WHERE company_id = $1 AND id = $2
			AND (analysis_status = 'pending' OR (analysis_status = 'analyzing' AND analysis_started_at < now() - make_interval(mins => $3)))
		RETURNING vapi_call_id, caller_number, ended_reason, transcript_encrypted`
	var c claimedCall
	err := a.Pool.QueryRow(ctx, statement, company.String(), callID, staleAnalysisMinutes).Scan(&c.vapiCallID, &c.callerNumber, &c.endedReason, &c.transcriptEncrypted)
	if errors.Is(err, pgx.ErrNoRows) {
		return claimedCall{}, false, nil
	}
	return c, err == nil, err
}

// decide asks the brain with the transcript and the active category names
// only (no company, caller number or ids). A transcript that can't be
// decrypted or a brain that doesn't answer is an escalation, never "solved".
func (a *Analyzer) decide(ctx context.Context, company tenant.CompanyID, call claimedCall) (decision, map[string]string, error) {
	if call.transcriptEncrypted == nil || *call.transcriptEncrypted == "" {
		return decision{Outcome: "needs_human", Source: "rule", ReasonCode: "no_transcript"}, nil, nil
	}
	transcript, err := a.Box.Decrypt(*call.transcriptEncrypted, TranscriptContext(company, call.vapiCallID))
	if err != nil {
		return decision{Outcome: "needs_human", Source: "rule", ReasonCode: "transcript_unreadable"}, nil, nil
	}
	categories, names, err := activeCategories(ctx, a.Pool, company)
	if err != nil {
		return decision{}, nil, err
	}
	request := map[string]any{"transcript": transcript, "ended_reason": call.endedReason, "categories": names}
	var d decision
	if err := a.Brain.Call(ctx, "/v1/calls/decide", request, &d); err != nil {
		return decision{Outcome: "needs_human", Source: "model", ReasonCode: "model_error", ErrorName: "BrainUnavailable"}, categories, nil
	}
	solvedWithoutProof := d.Outcome == "solved" && (d.ReasonCode != "model_solved" || d.ResolutionEvidence == nil || *d.ResolutionEvidence == "")
	if !knownOutcomes[d.Outcome] || !knownSources[d.Source] || reasonLabels[d.ReasonCode] == "" || solvedWithoutProof {
		return decision{Outcome: "needs_human", Source: "model", ReasonCode: "invalid_output"}, categories, nil
	}
	if d.ReasonCode == "model_error" {
		// A fixed line with the class: a revoked key and a wrong model name need different fixes.
		a.Log.Error("claude call failed", logging.Code(safeErrorClass(d.ErrorName)))
	}
	return d, categories, nil
}

// save stores the decision (the AI's texts encrypted for this call) and,
// for "needs_human", the call's request, in ONE transaction: a call is
// never escalated without its request, and never gets two.
func (a *Analyzer) save(ctx context.Context, company tenant.CompanyID, callID string, callerNumber *string, d decision, categories map[string]string) error {
	issue, err := a.sealed(d.CustomerIssue, "call-ai-issue:"+company.String()+":"+callID)
	if err != nil {
		return err
	}
	explanation, err := a.sealed(d.Explanation, "call-ai-explanation:"+company.String()+":"+callID)
	if err != nil {
		return err
	}
	var evidence *string
	if d.Outcome == "solved" {
		if evidence, err = a.sealed(d.ResolutionEvidence, EvidenceContext(company, callID)); err != nil {
			return err
		}
	}
	errorClass := ""
	if d.ReasonCode == "model_error" {
		errorClass = safeErrorClass(d.ErrorName)
	}
	return database.InTx(ctx, a.Pool, func(tx database.Tx) error {
		const statement = `
			UPDATE calls SET analysis_status = 'decided', ai_outcome = $3, ai_decision_source = $4, ai_reason_code = $5, ai_model = NULLIF($6, ''),
				ai_error_class = NULLIF($7, ''), ai_issue_encrypted = $8, ai_explanation_encrypted = $9, ai_evidence_encrypted = $10, decided_at = now(), updated_at = now()
			WHERE company_id = $1 AND id = $2 AND analysis_status = 'analyzing'`
		tag, err := tx.Exec(ctx, statement, company.String(), callID, d.Outcome, d.Source, d.ReasonCode, d.Model, errorClass, issue, explanation, evidence)
		if err != nil || tag.RowsAffected() == 0 {
			// Another run finished first: its decision stands.
			return err
		}
		if err := conversations.RecordCallDecisionWithin(ctx, tx, company, callID, d.Outcome == "needs_human"); err != nil {
			return err
		}
		if d.Outcome != "needs_human" {
			return nil
		}
		_, err = tickets.CreateCallTicketWithin(ctx, tx, company, callRequest(d, callerNumber, errorClass, callID, categories))
		return err
	})
}

// callRequest holds the AI's short summary only, in plain text: the
// transcript never goes on a request (it stays encrypted on the call).
func callRequest(d decision, callerNumber *string, errorClass, callID string, categories map[string]string) tickets.NewCallRequest {
	var parts []string
	for _, part := range []*string{d.CustomerIssue, d.Explanation} {
		if part != nil && strings.TrimSpace(*part) != "" {
			parts = append(parts, strings.TrimSpace(*part))
		}
	}
	parts = append(parts, "Escalated because: "+DescribeReason(d.ReasonCode, errorClass))
	subject := ""
	if d.TicketSubject != nil {
		subject = strings.TrimSpace(cutRunes(plaintext.SingleLine(*d.TicketSubject), 200))
	}
	if subject == "" {
		subject = fallbackSubject
	}
	categoryID := ""
	if d.Category != nil {
		categoryID = categories[*d.Category]
	}
	phone := ""
	if callerNumber != nil {
		phone = *callerNumber
	}
	return tickets.NewCallRequest{Subject: subject, Description: strings.Join(parts, "\n\n"), CategoryID: categoryID, CustomerPhone: phone, CallID: callID}
}

func (a *Analyzer) sealed(text *string, context string) (*string, error) {
	if text == nil || *text == "" {
		return nil, nil
	}
	stored, err := a.Box.Encrypt(*text, context)
	if err != nil {
		return nil, err
	}
	return &stored, nil
}

// EvidenceContext ties a solved call's quoted sentence to its call.
func EvidenceContext(company tenant.CompanyID, callID string) string {
	return "call-ai-evidence:" + company.String() + ":" + callID
}

// activeCategories are the company's active categories, name -> id (the
// pick is saved by id, so a rename while the AI thinks is followed).
func activeCategories(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (map[string]string, []string, error) {
	rows, err := pool.Query(ctx, `SELECT id, name FROM categories WHERE company_id = $1 AND archived_at IS NULL ORDER BY name`, company.String())
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	byName, names := map[string]string{}, []string{}
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, nil, err
		}
		byName[name] = id
		names = append(names, name)
	}
	return byName, names, rows.Err()
}

// safeErrorClass keeps an error class only as a plain name (a CHECK on
// calls.ai_error_class refuses anything else).
func safeErrorClass(name string) string {
	if errorClassName.MatchString(name) {
		return name
	}
	return "unknown"
}

func cutRunes(text string, max int) string {
	runes := []rune(text)
	if len(runes) <= max {
		return text
	}
	return string(runes[:max])
}
