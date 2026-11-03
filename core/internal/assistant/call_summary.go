package assistant

import (
	"context"
	"encoding/json"
	"errors"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/jobs"
	"ansa/core/internal/logging"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
	"ansa/core/internal/tickets"
)

// What a finished call was about (step 55): when the caller hangs up, the AI
// writes a short note for the person (who called, what they want, how and
// when to reach them) with the company's own AI engine. The note joins the
// conversation's open request; with none open, a request is opened for it
// when someone has to act. A note that can't be written changes nothing:
// the caller's words are in the conversation, and a message ansa took has
// its request already (CallMessagesLeftWithin).

// CallSummaryJobKind writes one finished call's note (queued when it ends).
const CallSummaryJobKind = "phone.call_summary"

// CallSummaryPayload names the call.
type CallSummaryPayload struct {
	CallID string `json:"callId"`
}

// The brain reads at most this many of a call's lines: its first ones (who
// is calling, why) and its newest.
const (
	callNoteFirstLines = 8
	callNoteLastLines  = 32
)

// The most a request's description holds (the ticket rules: 1-10,000).
const descriptionMaxRunes = 10_000

// callSummaryRequest matches the brain's CallSummaryRequest
// (brain/brain/assistant/call_summary.py): never an id.
type callSummaryRequest struct {
	Kind         string  `json:"kind"`
	Name         string  `json:"name"`
	Conversation []Line  `json:"conversation"`
	Engine       string  `json:"engine"`
	APIKey       *string `json:"api_key"`
}

// callNote is the brain's answer.
type callNote struct {
	Kind        string `json:"kind"`
	Reason      string `json:"reason"`
	Subject     string `json:"subject"`
	Summary     string `json:"summary"`
	NeedsPerson bool   `json:"needs_person"`
}

// HandleCallSummaryJob runs the "phone.call_summary" job.
func (r *Runner) HandleCallSummaryJob(ctx context.Context, job *jobs.Job) error {
	var payload CallSummaryPayload
	if json.Unmarshal(job.Payload, &payload) != nil || !idPattern.MatchString(payload.CallID) {
		return &jobs.Failure{Code: "bad_payload", Permanent: true}
	}
	call, err := readFinishedCall(ctx, r.Pool, r.Box, job.CompanyID, payload.CallID)
	if err != nil || call == nil {
		return err
	}
	request, err := r.callSummaryRequest(ctx, job.CompanyID, call.Lines)
	if err != nil {
		return err
	}
	if request == nil {
		// The business's own key can't be read: ansa's is never used in its place.
		r.Log.Info("assistant: call note not written", logging.Code("model_unavailable"))
		return nil
	}
	var note callNote
	if err := r.Brain.Call(ctx, "/v1/calls/summary", request, &note); err != nil {
		r.Log.Error("assistant: brain unavailable", logging.ErrorType(err))
		return err
	}
	if note.Kind != "ok" {
		r.Log.Info("assistant: call note not written", logging.Code(knownNoteFailure(note.Reason)))
		return nil
	}
	return saveCallNote(ctx, r.Pool, job.CompanyID, call, note)
}

// callSummaryRequest is the brain's slice for a call's note: who ansa
// answered for, the call's lines and the company's AI engine; nil when the
// business's own key can't be read.
func (r *Runner) callSummaryRequest(ctx context.Context, company tenant.CompanyID, lines []Line) (*callSummaryRequest, error) {
	settings, err := readSettings(ctx, r.Pool, company)
	if err != nil {
		return nil, err
	}
	kind, name, err := ReadCallVoice(ctx, r.Pool, company)
	if err != nil {
		return nil, err
	}
	request := &callSummaryRequest{Kind: kind, Name: name, Conversation: lines, Engine: settings.AIEngine}
	if settings.AIEngine == "api_key" && settings.KeyEncrypted != nil {
		key, err := r.Box.Decrypt(*settings.KeyEncrypted, KeyContext(company))
		if err != nil {
			return nil, nil
		}
		request.APIKey = &key
	}
	return request, nil
}

// knownNoteFailure is the brain's reason as one of its known codes.
func knownNoteFailure(reason string) string {
	if reason == "model_unavailable" || reason == "unusable_answer" {
		return reason
	}
	return "model_failed"
}

// saveCallNote adds the note to the conversation's open request (while its
// description has room, and its subject when ansa opened it during this
// call), or opens a request for it when someone has to act (routed, ansa's
// line, the owners' alert), in ONE transaction that takes the company row
// lock first (as every routing does).
func saveCallNote(ctx context.Context, pool *database.Pool, company tenant.CompanyID, call *finishedCall, note callNote) error {
	summary := cutRunes(note.Summary, 1_000)
	conversationID := call.ConversationID
	return database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		var requestID string
		var openedDuringCall bool
		// Opened during this call means before it ended too: the caller's next
		// call may open a request before this note is written.
		const newestOpen = `
			SELECT id, created_at BETWEEN $3 AND $4 FROM tickets
			WHERE company_id = $1 AND conversation_id = $2 AND status = 'open'
			ORDER BY created_at DESC LIMIT 1 FOR NO KEY UPDATE`
		err := tx.QueryRow(ctx, newestOpen, company.String(), conversationID, call.StartedAt, call.EndedAt).Scan(&requestID, &openedDuringCall)
		switch {
		case err == nil:
			return addNoteToRequestWithin(ctx, tx, company, requestID, openedDuringCall, note.Subject, summary)
		case !errors.Is(err, pgx.ErrNoRows):
			return err
		case !note.NeedsPerson:
			// No request open and nothing waits for a person: nothing to add.
			return nil
		}
		name, number, err := callerWithin(ctx, tx, company, conversationID)
		if err != nil {
			return err
		}
		// Its own alert: the one for the messages ansa took (CallMessagesLeftWithin) may still wait.
		turn := conversations.Turn{CompanyID: company, ConversationID: conversationID, TriggerMessageID: "note-" + call.ID}
		info := conversationInfo{ConversationID: conversationID, Channel: conversations.ChannelPhone, ContactName: name, CallerNumber: number}
		fields, err := requestFields(ctx, tx, turn, info, Handover{Reason: "call_message", Subject: note.Subject, Summary: summary})
		if err != nil {
			return err
		}
		if _, err := tickets.CreateChatTicketWithin(ctx, tx, company, fields); err != nil {
			return err
		}
		if err := recordActivity(ctx, tx, turn, "handed_over", "call_message"); err != nil {
			return err
		}
		return enqueueAlert(ctx, tx, turn, "call_message", false, "")
	})
}

// addNoteToRequestWithin adds the note below the request's description while
// it has room (the ticket rules: at most 10,000 characters), and gives a
// request ansa opened during this call the note's subject.
func addNoteToRequestWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, requestID string, openedDuringCall bool, subject, summary string) error {
	const addToRequest = `
		UPDATE tickets SET description = description || $3
		WHERE company_id = $1 AND id = $2 AND char_length(description) + char_length($3) <= $4`
	if _, err := tx.Exec(ctx, addToRequest, company.String(), requestID, "\n\nAfter the call: "+summary, descriptionMaxRunes); err != nil {
		return err
	}
	subject = plaintext.SingleLine(subject)
	if !openedDuringCall || subject == "" || utf8.RuneCountInString(subject) > 200 {
		return nil
	}
	return tickets.RetitleAfterCallWithin(ctx, tx, company, requestID, subject)
}
