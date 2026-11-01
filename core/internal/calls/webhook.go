package calls

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/files"
	"ansa/core/internal/httpserver"
	"ansa/core/internal/jobs"
	"ansa/core/internal/logging"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
	"ansa/core/internal/tickets"
)

// Vapi's webhook: at most 1 MB; 10,000 a minute per IP (all of Vapi's
// traffic shares it: a ceiling against a leaked secret).
var webhookPerIP = ratelimit.Rule{MaxAttempts: 10_000, Window: time.Minute}

const webhookMaxBytes = 1 << 20

// AnalyzeJobKind decides a saved call (after Vapi has its answer).
const AnalyzeJobKind = "call.analyze"

// AnalyzePayload names the call.
type AnalyzePayload struct {
	CallID string `json:"callId"`
}

// Webhook is POST /webhooks/vapi.
type Webhook struct {
	Pool    *database.Pool
	Box     *secure.Box
	Limiter *ratelimit.Limiter
	Log     *logging.Logger
	Signing Signing
	// Recordings are copied from these hosts only (VAPI_RECORDING_HOSTS).
	RecordingHosts []string
	Files          *files.Store
	// Answers the live assistant's knowledge searches (tool-calls).
	Tools *Tools
}

// ServeHTTP keeps the order every webhook keeps: size cap, raw bytes,
// Vapi's signature and time, the per-IP limit, then JSON.
func (h *Webhook) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, err := httpserver.ReadBody(r, webhookMaxBytes)
	if err == httpserver.ErrTooLarge {
		h.Log.Warn("vapi webhook rejected", logging.Code("too_large"))
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		return
	}
	if err != nil || !h.Signing.Valid(body, r.Header.Get(h.Signing.SignatureHeader), r.Header.Get(h.Signing.TimestampHeader), time.Now()) {
		h.Log.Warn("vapi webhook rejected", logging.Code("invalid_signature"))
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if over, err := h.Limiter.Over(r.Context(), "vapi-webhook", httpserver.ClientIP(r), webhookPerIP); err != nil || over {
		h.Log.Warn("vapi webhook rejected", logging.Code("rate_limited"))
		w.WriteHeader(http.StatusTooManyRequests)
		return
	}
	var kind struct {
		Message struct {
			Type string `json:"type"`
		} `json:"message"`
	}
	if json.Unmarshal(body, &kind) != nil || kind.Message.Type == "" || len(kind.Message.Type) > 100 {
		h.Log.Warn("vapi webhook rejected", logging.Code("not_a_vapi_message"))
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	switch kind.Message.Type {
	case "tool-calls":
		// Always 200 with one answer per tool call: Vapi ignores anything else.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(h.Tools.Answer(r.Context(), body))
	case "end-of-call-report":
		h.endOfCall(w, r, body)
	default:
		// Other events (status updates, live transcript pieces) aren't used.
		w.WriteHeader(http.StatusOK)
	}
}

// report is what core keeps of an end-of-call report (everything else, the
// costs and the assistant's settings, is dropped on reading).
type report struct {
	Message struct {
		EndedReason string     `json:"endedReason"`
		StartedAt   *time.Time `json:"startedAt"`
		EndedAt     *time.Time `json:"endedAt"`
		Artifact    *struct {
			Transcript   string `json:"transcript"`
			RecordingURL string `json:"recordingUrl"`
			Recording    *struct {
				Mono *struct {
					CombinedURL string `json:"combinedUrl"`
				} `json:"mono"`
			} `json:"recording"`
		} `json:"artifact"`
		RecordingURL string `json:"recordingUrl"`
		Transcript   string `json:"transcript"`
		Call         struct {
			ID            string     `json:"id"`
			PhoneNumberID string     `json:"phoneNumberId"`
			StartedAt     *time.Time `json:"startedAt"`
			EndedAt       *time.Time `json:"endedAt"`
			Customer      *struct {
				Number string `json:"number"`
			} `json:"customer"`
		} `json:"call"`
	} `json:"message"`
}

func (h *Webhook) endOfCall(w http.ResponseWriter, r *http.Request, body []byte) {
	var rep report
	m := &rep.Message
	if json.Unmarshal(body, &rep) != nil || m.Call.ID == "" || len(m.Call.ID) > 200 || m.Call.PhoneNumberID == "" || len(m.Call.PhoneNumberID) > 200 ||
		len(m.EndedReason) > 200 || len(m.Transcript) > 500_000 || (m.Artifact != nil && len(m.Artifact.Transcript) > 500_000) {
		h.Log.Warn("vapi webhook rejected", logging.Code("invalid_end_of_call_report"))
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	saved, err := h.save(r.Context(), &rep)
	if err != nil {
		h.Log.Error("vapi webhook failed", logging.ErrorType(err))
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	if saved.outcome == "unknown-phone-line" {
		h.Log.Warn("vapi webhook ignored", logging.Code("unknown_phone_line"))
	}
	if saved.outcome == "saved" && saved.recordingURL != "" {
		// Copied once, right after the answer: the address is never stored
		// (not even in a job), so a failed copy isn't tried again.
		go h.copyRecording(context.WithoutCancel(r.Context()), saved.company, saved.callID, saved.recordingURL)
	}
	w.WriteHeader(http.StatusOK)
}

type savedCall struct {
	outcome, callID, recordingURL string
	company                       tenant.CompanyID
}

// save keeps a new call for the company its phone line belongs to (nothing
// in the payload is trusted for that), the transcript encrypted, the caller
// joined to their conversation, and its analysis queued, in ONE
// transaction. A call Vapi sends twice is saved once.
func (h *Webhook) save(ctx context.Context, rep *report) (savedCall, error) {
	m := &rep.Message
	var lineID, companyText string
	const findLine = `
		-- cross-company: ansa links phone lines; Vapi's number id names the one company that has it.
		SELECT id, company_id FROM phone_lines WHERE vapi_phone_number_id = $1`
	err := h.Pool.QueryRow(ctx, findLine, m.Call.PhoneNumberID).Scan(&lineID, &companyText)
	if errors.Is(err, pgx.ErrNoRows) {
		return savedCall{outcome: "unknown-phone-line"}, nil
	}
	if err != nil {
		return savedCall{}, err
	}
	company, err := tenant.FromTrustedSource(companyText)
	if err != nil {
		return savedCall{}, err
	}
	transcript := m.Transcript
	recordingURL := m.RecordingURL
	if m.Artifact != nil {
		if m.Artifact.Transcript != "" {
			transcript = m.Artifact.Transcript
		}
		if m.Artifact.RecordingURL != "" {
			recordingURL = m.Artifact.RecordingURL
		}
		if m.Artifact.Recording != nil && m.Artifact.Recording.Mono != nil && m.Artifact.Recording.Mono.CombinedURL != "" {
			recordingURL = m.Artifact.Recording.Mono.CombinedURL
		}
	}
	var encrypted *string
	if transcript != "" {
		sealed, err := h.Box.Encrypt(transcript, TranscriptContext(company, m.Call.ID))
		if err != nil {
			return savedCall{}, err
		}
		encrypted = &sealed
	}
	caller := ""
	if m.Call.Customer != nil && len(m.Call.Customer.Number) <= 40 {
		caller = m.Call.Customer.Number
	}
	started, ended := firstTime(m.StartedAt, m.Call.StartedAt), firstTime(m.EndedAt, m.Call.EndedAt)
	saved := savedCall{outcome: "duplicate", company: company}
	err = database.InTx(ctx, h.Pool, func(tx database.Tx) error {
		const insert = `
			INSERT INTO calls (company_id, phone_line_id, vapi_call_id, caller_number, started_at, ended_at, ended_reason, transcript_encrypted)
			VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, NULLIF($7, ''), $8)
			ON CONFLICT (vapi_call_id) DO NOTHING
			RETURNING id`
		var callID string
		err := tx.QueryRow(ctx, insert, company.String(), lineID, m.Call.ID, caller, started, ended, m.EndedReason, encrypted).Scan(&callID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if contact := phoneContact(caller); contact != nil {
			if err := conversations.LinkCallWithin(ctx, tx, company, *contact, callID); err != nil {
				return err
			}
		}
		if _, err := jobs.EnqueueWithin(ctx, tx, company, jobs.NewJob{Kind: AnalyzeJobKind, Payload: AnalyzePayload{CallID: callID}, MaxAttempts: 3}); err != nil {
			return err
		}
		saved = savedCall{outcome: "saved", company: company, callID: callID, recordingURL: recordingURL}
		return nil
	})
	return saved, err
}

// TranscriptContext ties a transcript to its company and Vapi's call id.
func TranscriptContext(company tenant.CompanyID, vapiCallID string) string {
	return "call-transcript:" + company.String() + ":" + vapiCallID
}

// phoneContact is a caller as a customer: by the digits of their number;
// a hidden caller is nobody (no conversation).
func phoneContact(caller string) *conversations.ContactKey {
	digits := tickets.CustomerPhoneDigits(caller)
	if digits == "" {
		return nil
	}
	name := plaintext.SingleLine(caller)
	return &conversations.ContactKey{Channel: conversations.ChannelPhone, ExternalID: digits, DisplayName: &name}
}

func firstTime(values ...*time.Time) *time.Time {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}
