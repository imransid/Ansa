package calls

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// The Calls page and a call's page (the old services/calls.ts).

const pageSize = 50

// Filters of the list: what the AI decided, or stuck. Odd values = "all".
var outcomeFilters = map[string]string{
	"all":         `true`,
	"solved":      `(calls.analysis_status = 'decided' AND calls.ai_outcome = 'solved')`,
	"needs_human": `(calls.analysis_status = 'decided' AND calls.ai_outcome = 'needs_human')`,
	"stuck":       stuckCondition,
}

// A call not decided 5+ minutes after it was saved, or after its analysis
// started: its run was cut off ("Stuck: analyze now").
const stuckCondition = `((calls.analysis_status = 'pending' AND calls.created_at < now() - interval '5 minutes')
	OR (calls.analysis_status = 'analyzing' AND calls.analysis_started_at < now() - interval '5 minutes'))`

// The search: the text anywhere in the caller's number ($2), or the same
// digits however it is written ($3). Caller numbers are stored plain.
const searchCondition = `($2::text = '' OR calls.caller_number ILIKE $2
	OR ($3::text <> '' AND regexp_replace(calls.caller_number, '[^0-9]', '', 'g') LIKE '%' || $3::text || '%'))`

var phoneText = regexp.MustCompile(`^[\d\s+().-]+$`)
var nonDigits = regexp.MustCompile(`\D`)

// IsOutcomeFilter says whether a filter is one of the list's.
func IsOutcomeFilter(filter string) bool {
	_, known := outcomeFilters[filter]
	return known
}

// Row is one call as the list shows it (never the transcript).
type Row struct {
	ID                string     `json:"id"`
	CallerNumber      *string    `json:"callerNumber"`
	StartedAt         *time.Time `json:"startedAt"`
	EndedAt           *time.Time `json:"endedAt"`
	EndedReason       *string    `json:"endedReason"`
	AnalysisStatus    string     `json:"analysisStatus"`
	AIOutcome         *string    `json:"aiOutcome"`
	CreatedAt         time.Time  `json:"createdAt"`
	AnalysisStartedAt *time.Time `json:"analysisStartedAt"`
	AnalysisStuck     bool       `json:"analysisStuck"`
	EscalatedAt       *time.Time `json:"escalatedAt"`
}

const rowColumns = `calls.id, calls.caller_number, calls.started_at, calls.ended_at, calls.ended_reason, calls.analysis_status::text,
	calls.ai_outcome::text, calls.created_at, calls.analysis_started_at, ` + stuckCondition + `, calls.escalated_at`

func scanRow(row pgx.Row, r *Row) error {
	return row.Scan(&r.ID, &r.CallerNumber, &r.StartedAt, &r.EndedAt, &r.EndedReason, &r.AnalysisStatus,
		&r.AIOutcome, &r.CreatedAt, &r.AnalysisStartedAt, &r.AnalysisStuck, &r.EscalatedAt)
}

// searchArguments turns what someone typed into the ILIKE pattern and the
// digits of a phone number (3 or more), "" for none.
func searchArguments(q string) (pattern, digits string) {
	q = strings.TrimSpace(q)
	if q == "" {
		return "", ""
	}
	pattern = "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q) + "%"
	if phoneText.MatchString(q) {
		if only := nonDigits.ReplaceAllString(q, ""); len(only) >= 3 {
			digits = only
		}
	}
	return pattern, digits
}

// List is one page of the company's calls with one filter and a search,
// newest first.
func List(ctx context.Context, pool *database.Pool, company tenant.CompanyID, filter, q string, page int) ([]Row, error) {
	if !IsOutcomeFilter(filter) {
		filter = "all"
	}
	pattern, digits := searchArguments(q)
	statement := `
		SELECT ` + rowColumns + `
		FROM calls
		WHERE calls.company_id = $1 AND ` + outcomeFilters[filter] + ` AND ` + searchCondition + `
		ORDER BY calls.created_at DESC, calls.id DESC
		LIMIT $4 OFFSET $5`
	rows, err := pool.Query(ctx, statement, company.String(), pattern, digits, pageSize, (max(page, 1)-1)*pageSize)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []Row{}
	for rows.Next() {
		var r Row
		if err := scanRow(rows, &r); err != nil {
			return nil, err
		}
		list = append(list, r)
	}
	return list, rows.Err()
}

// Counts are the calls under every filter with the same search (the
// filter links and "Page x of y"), each with its filter's own condition.
func Counts(ctx context.Context, pool *database.Pool, company tenant.CompanyID, q string) (map[string]int, error) {
	pattern, digits := searchArguments(q)
	statement := `
		SELECT count(*), count(*) FILTER (WHERE ` + outcomeFilters["solved"] + `), count(*) FILTER (WHERE ` + outcomeFilters["needs_human"] + `),
			count(*) FILTER (WHERE ` + stuckCondition + `)
		FROM calls
		WHERE calls.company_id = $1 AND ` + searchCondition
	var all, solved, needsHuman, stuck int
	err := pool.QueryRow(ctx, statement, company.String(), pattern, digits).Scan(&all, &solved, &needsHuman, &stuck)
	return map[string]int{"all": all, "solved": solved, "needs_human": needsHuman, "stuck": stuck}, err
}

// Detail is one call with its transcript and the AI's notes, decrypted.
type Detail struct {
	Row
	Transcript           *string    `json:"transcript"`
	TranscriptUnreadable bool       `json:"transcriptUnreadable"`
	RecordingStatus      string     `json:"recordingStatus"`
	TicketNumber         *int       `json:"ticketNumber"`
	Escalation           *Escalated `json:"escalation"`
	Analysis             Analysis   `json:"analysis"`
}

// Escalated says who escalated a call the AI marked solved, and when.
type Escalated struct {
	ByName *string   `json:"byName"`
	At     time.Time `json:"at"`
}

// Analysis is what the AI decided and why.
type Analysis struct {
	Source        *string    `json:"source"`
	ReasonCode    *string    `json:"reasonCode"`
	Reason        string     `json:"reason"`
	Model         *string    `json:"model"`
	DecidedAt     *time.Time `json:"decidedAt"`
	Issue         *string    `json:"issue"`
	Explanation   *string    `json:"explanation"`
	ErrorClass    *string    `json:"errorClass"`
	Evidence      *string    `json:"evidence"`
	CanAnalyzeNow bool       `json:"canAnalyzeNow"`
	CanEscalate   bool       `json:"canEscalate"`
}

// Find reads one call of the company (nil: none, or another company's).
func Find(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, callID string) (*Detail, error) {
	statement := `
		SELECT ` + rowColumns + `, calls.vapi_call_id, calls.transcript_encrypted, calls.recording_status::text,
			(SELECT ticket_number FROM tickets WHERE tickets.company_id = calls.company_id AND tickets.call_id = calls.id),
			escalator.name, calls.ai_decision_source::text, calls.ai_reason_code, calls.ai_model, calls.decided_at,
			calls.ai_issue_encrypted, calls.ai_explanation_encrypted, calls.ai_error_class, calls.ai_evidence_encrypted
		FROM calls
		LEFT JOIN users AS escalator ON escalator.company_id = calls.company_id AND escalator.id = calls.escalated_by_user_id
		WHERE calls.company_id = $1 AND calls.id = $2`
	var d Detail
	var vapiCallID string
	var transcript, issue, explanation, evidence *string
	r := &d.Row
	a := &d.Analysis
	var escalatorName *string
	err := pool.QueryRow(ctx, statement, company.String(), callID).Scan(&r.ID, &r.CallerNumber, &r.StartedAt, &r.EndedAt, &r.EndedReason,
		&r.AnalysisStatus, &r.AIOutcome, &r.CreatedAt, &r.AnalysisStartedAt, &r.AnalysisStuck, &r.EscalatedAt,
		&vapiCallID, &transcript, &d.RecordingStatus, &d.TicketNumber, &escalatorName, &a.Source, &a.ReasonCode, &a.Model, &a.DecidedAt,
		&issue, &explanation, &a.ErrorClass, &evidence)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	d.Transcript, d.TranscriptUnreadable = open(box, transcript, TranscriptContext(company, vapiCallID))
	a.Issue, _ = open(box, issue, "call-ai-issue:"+company.String()+":"+d.ID)
	a.Explanation, _ = open(box, explanation, "call-ai-explanation:"+company.String()+":"+d.ID)
	a.Evidence, _ = open(box, evidence, EvidenceContext(company, d.ID))
	if a.ReasonCode != nil {
		errorClass := ""
		if a.ErrorClass != nil {
			errorClass = *a.ErrorClass
		}
		a.Reason = DescribeReason(*a.ReasonCode, errorClass)
	}
	if r.EscalatedAt != nil {
		d.Escalation = &Escalated{ByName: escalatorName, At: *r.EscalatedAt}
	}
	a.CanAnalyzeNow = r.AnalysisStatus == "pending" || r.AnalysisStuck
	a.CanEscalate = r.AnalysisStatus == "decided" && r.AIOutcome != nil && *r.AIOutcome == "solved" && r.EscalatedAt == nil && d.TicketNumber == nil
	return &d, nil
}

// open decrypts a stored text; unreadable (a wrong key, damaged data) is
// said, never shown as empty.
func open(box *secure.Box, stored *string, context string) (*string, bool) {
	if stored == nil || *stored == "" {
		return nil, false
	}
	text, err := box.Decrypt(*stored, context)
	if err != nil {
		return nil, true
	}
	return &text, false
}
