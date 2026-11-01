package calls

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/knowledge"
	"ansa/core/internal/logging"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/tenant"
)

// The live voice assistant's one tool (its definition in Vapi:
// docs/going-live.md, section 4): search_company_knowledge.
//
// LOGGING RULE: a tool call holds what the caller asked, and the message
// the live transcript. Never log the query, the answer or any part of the
// message: fixed lines and class names only.
const KnowledgeToolName = "search_company_knowledge"

// The most tool calls one message may hold, and the longest question.
const (
	maxToolCallsPerMessage = 10
	maxQuestionLength      = 500
)

// 120 searches a minute per company, on top of the per-IP limit.
var lookupsPerCompany = ratelimit.Rule{MaxAttempts: 120, Window: time.Minute}

// What the assistant is told when there is no answer for it.
const (
	errorNotSetUp    = "This phone number is not set up."
	errorUnknownTool = "Unknown tool."
	errorRateLimited = "Too many knowledge searches right now. Offer to pass the question to the team as a ticket."
	errorFailed      = "The knowledge base could not be searched right now. Offer to pass the question to the team as a ticket."
)

var errorBadArguments = `Send the caller's question as "query": text of 1 to ` + strconv.Itoa(maxQuestionLength) + " characters."

// Tools answers a signed tool-calls message.
type Tools struct {
	Pool    *database.Pool
	Limiter *ratelimit.Limiter
	Log     *logging.Logger
}

// ToolResult is one entry of the answer: a result or an error, one line each.
type ToolResult struct {
	Name       string `json:"name"`
	ToolCallID string `json:"toolCallId"`
	Result     string `json:"result,omitempty"`
	Error      string `json:"error,omitempty"`
}

// ToolAnswer is what Vapi gets back, always with HTTP 200.
type ToolAnswer struct {
	Results []ToolResult `json:"results"`
}

// Only these fields are read: the live transcript (message.artifact) and
// message.phoneNumber (which can hold the phone provider's secrets) never are.
type toolCallsMessage struct {
	Message struct {
		ToolCallList []json.RawMessage `json:"toolCallList"`
		Call         *struct {
			ID            *string `json:"id"`
			PhoneNumberID *string `json:"phoneNumberId"`
		} `json:"call"`
	} `json:"message"`
}

type toolCall struct {
	ID       string `json:"id"`
	Function struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	} `json:"function"`
}

// Answer gives one entry per tool call that has an id to answer to. Never
// fails: a failure is an error entry.
func (t *Tools) Answer(ctx context.Context, body []byte) ToolAnswer {
	var message toolCallsMessage
	if json.Unmarshal(body, &message) != nil || len(message.Message.ToolCallList) > maxToolCallsPerMessage {
		t.Log.Warn("vapi tool call rejected", logging.Code("invalid_tool_calls_message"))
		return ToolAnswer{Results: []ToolResult{}}
	}
	calls := readToolCalls(message.Message.ToolCallList)
	vapiCallID, phoneNumberID := "", ""
	if c := message.Message.Call; c != nil {
		vapiCallID, phoneNumberID = idOrEmpty(c.ID), idOrEmpty(c.PhoneNumberID)
	}
	company, found, err := t.companyOfLine(ctx, phoneNumberID)
	if err != nil {
		t.Log.Error("vapi tool call failed", logging.ErrorType(err))
		return answerAll(calls, errorFailed)
	}
	if !found {
		t.Log.Warn("vapi tool call ignored", logging.Code("unknown_phone_line"))
		return answerAll(calls, errorNotSetUp)
	}
	results := make([]ToolResult, 0, len(calls))
	limited := false
	for _, call := range calls {
		result := t.answerOne(ctx, company, vapiCallID, call)
		limited = limited || result.Error == errorRateLimited
		results = append(results, result)
	}
	if limited {
		// Once per message, however many of its tool calls were refused.
		t.Log.Warn("vapi tool call refused", logging.Code("rate_limited"))
	}
	return ToolAnswer{Results: results}
}

// answerOne searches the company's approved support articles and records
// which articles the answer held BEFORE giving it, so the call page lists
// exactly what the assistant got. Without Vapi's call id nothing is
// recorded (there would be no call to show it on).
func (t *Tools) answerOne(ctx context.Context, company tenant.CompanyID, vapiCallID string, call toolCall) ToolResult {
	if call.Function.Name != KnowledgeToolName {
		return errorFor(call, errorUnknownTool)
	}
	query, ok := readQuery(call.Function.Arguments)
	if !ok {
		return errorFor(call, errorBadArguments)
	}
	if over, err := t.Limiter.Over(ctx, "knowledge-lookups", company.String(), lookupsPerCompany); err != nil || over {
		if err != nil {
			t.Log.Error("vapi tool call failed", logging.ErrorType(err))
			return errorFor(call, errorFailed)
		}
		return errorFor(call, errorRateLimited)
	}
	hits, err := knowledge.Search(ctx, t.Pool, company, query, "support", knowledge.CallAnswerMaxHits)
	if err != nil {
		t.Log.Error("vapi tool call failed", logging.ErrorType(err))
		return errorFor(call, errorFailed)
	}
	answer := knowledge.BuildCallAnswer(hits)
	if vapiCallID != "" {
		const record = `INSERT INTO knowledge_lookups (company_id, vapi_call_id, article_ids, hit_count) VALUES ($1, $2, $3::uuid[], $4)`
		if _, err := t.Pool.Exec(ctx, record, company.String(), vapiCallID, answer.ArticleIDs, answer.HitCount); err != nil {
			t.Log.Error("vapi tool call failed", logging.ErrorType(err))
			return errorFor(call, errorFailed)
		}
	}
	return ToolResult{Name: call.Function.Name, ToolCallID: call.ID, Result: answer.Text}
}

// companyOfLine is the company of the phone line the call came in on, the
// only thing that decides it. A web call has no line.
func (t *Tools) companyOfLine(ctx context.Context, phoneNumberID string) (tenant.CompanyID, bool, error) {
	if phoneNumberID == "" {
		return tenant.CompanyID{}, false, nil
	}
	var companyText string
	const findLine = `
		-- cross-company: ansa links phone lines; Vapi's number id names the one company that has it.
		SELECT company_id FROM phone_lines WHERE vapi_phone_number_id = $1`
	err := t.Pool.QueryRow(ctx, findLine, phoneNumberID).Scan(&companyText)
	if errors.Is(err, pgx.ErrNoRows) {
		return tenant.CompanyID{}, false, nil
	}
	if err != nil {
		return tenant.CompanyID{}, false, err
	}
	company, err := tenant.FromTrustedSource(companyText)
	return company, err == nil, err
}

// readToolCalls keeps the entries that can be answered: an id and a
// function name, each one line (they are echoed back).
func readToolCalls(entries []json.RawMessage) []toolCall {
	var calls []toolCall
	for _, entry := range entries {
		var call toolCall
		if json.Unmarshal(entry, &call) != nil || !isVapiID(call.ID) || len(call.Function.Name) > 80 || plaintext.SingleLine(call.Function.Name) != call.Function.Name {
			continue
		}
		calls = append(calls, call)
	}
	return calls
}

// readQuery reads { "query": "..." }, given as an object or as a JSON
// string (Vapi's spec and docs disagree), as one plain line of 1-500.
func readQuery(arguments json.RawMessage) (string, bool) {
	var asString string
	if json.Unmarshal(arguments, &asString) == nil {
		arguments = json.RawMessage(asString)
	}
	var parsed struct {
		Query *string `json:"query"`
	}
	if json.Unmarshal(arguments, &parsed) != nil || parsed.Query == nil {
		return "", false
	}
	query := plaintext.SingleLine(*parsed.Query)
	length := utf8.RuneCountInString(query)
	return query, length >= 1 && length <= maxQuestionLength
}

func isVapiID(id string) bool {
	return id != "" && len(id) <= 200 && plaintext.SingleLine(id) == id
}

// idOrEmpty treats a missing, null or odd id as missing.
func idOrEmpty(id *string) string {
	if id == nil || !isVapiID(*id) {
		return ""
	}
	return *id
}

func answerAll(calls []toolCall, message string) ToolAnswer {
	results := make([]ToolResult, 0, len(calls))
	for _, call := range calls {
		results = append(results, errorFor(call, message))
	}
	return ToolAnswer{Results: results}
}

func errorFor(call toolCall, message string) ToolResult {
	return ToolResult{Name: call.Function.Name, ToolCallID: call.ID, Error: message}
}
