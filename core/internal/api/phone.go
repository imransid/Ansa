package api

import (
	"encoding/base64"
	"errors"
	"net/http"
	"time"

	"ansa/core/internal/phone"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
)

// The practice phone (step 55, development only): an owner calls their own
// ansa from the laptop. The page records the caller's voice, core has the
// brain's local Whisper hear it, answers through the phone line's door
// (core/internal/phone: the same assistant as chats), and the page speaks
// ansa's words. A production line (Vapi, Twilio, Telnyx or LiveKit, chosen
// at launch) will use the same door from its own webhook.

var (
	practiceCalls = ratelimit.Rule{MaxAttempts: 30, Window: time.Hour}
	practiceTurns = ratelimit.Rule{MaxAttempts: 300, Window: time.Hour}
)

// A turn's body: a recording of up to about a minute (16 kHz mono, 2 MB) as base64.
const practiceTurnBodyBytes = 3 << 20

const practiceOnly = "The practice phone is for development only: real calls come through ansa's phone number."

func (s *Server) registerPhone(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/phone/practice", s.withSession(s.practicePhone))
	routes.HandleFunc("POST /api/v1/phone/practice/start", s.withSession(s.withPracticePhone(s.startPracticeCall)))
	routes.HandleFunc("POST /api/v1/phone/practice/turn", s.withSessionUpTo(practiceTurnBodyBytes, s.withPracticePhone(s.practiceCallTurn)))
	routes.HandleFunc("POST /api/v1/phone/practice/end", s.withSession(s.withPracticePhone(s.endPracticeCall)))
}

// practicePhone: GET: {available (development, and an owner), isOwner}.
func (s *Server) practicePhone(w http.ResponseWriter, _ *http.Request, _ []byte, who *session.Session) {
	writeJSON(w, http.StatusOK, map[string]bool{"available": s.Development && s.Phone != nil && who.IsOwner(), "isOwner": who.IsOwner()})
}

// withPracticePhone lets only an owner use it, and only in development.
func (s *Server) withPracticePhone(h handler) handler {
	return func(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
		switch {
		case !s.Development || s.Phone == nil:
			problem(w, http.StatusForbidden, practiceOnly)
		case !who.IsOwner():
			problem(w, http.StatusForbidden, "Only owners can use the practice phone.")
		default:
			h(w, r, body, who)
		}
	}
}

// startPracticeCall: POST {callerName, callerNumber}: {callId, conversationId, words}.
func (s *Server) startPracticeCall(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		CallerName   string `json:"callerName"`
		CallerNumber string `json:"callerNumber"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "practice-calls", who.CompanyID.String(), practiceCalls); err != nil || over {
		problem(w, http.StatusTooManyRequests, "That's a lot of practice calls this hour. Try again later.")
		return
	}
	started, err := s.Phone.Start(r.Context(), who.CompanyID, phone.Caller{Line: phone.LinePractice, Number: input.CallerNumber, Name: input.CallerName})
	switch {
	case errors.Is(err, phone.ErrBadNumber):
		fieldProblems(w, map[string]string{"callerNumber": "Write a phone number with at least 7 digits."})
	case err != nil:
		s.failed(w, "practice call", err)
	default:
		writeJSON(w, http.StatusOK, map[string]any{"callId": started.CallID, "conversationId": started.ConversationID, "words": started.Words})
	}
}

// practiceCallTurn: POST {callId, text} or {callId, audio (16 kHz mono WAV,
// base64)}: {heard, words}. What the caller said is heard by the brain's
// local Whisper when it is a recording.
func (s *Server) practiceCallTurn(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		CallID string `json:"callId"`
		Text   string `json:"text"`
		Audio  string `json:"audio"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "practice-turns", who.CompanyID.String(), practiceTurns); err != nil || over {
		problem(w, http.StatusTooManyRequests, "That's a lot of talking this hour. Try again later.")
		return
	}
	// Hearing, then the assistant's answer: both may wait for the brain.
	allowLongAnswer(w, 4*time.Minute)
	heard := input.Text
	if input.Audio != "" {
		audio, err := base64.StdEncoding.DecodeString(input.Audio)
		if err != nil || len(audio) == 0 {
			problem(w, http.StatusBadRequest, "The recording couldn't be read. Try again.")
			return
		}
		if heard, err = s.Phone.Hear(r.Context(), audio); err != nil {
			problem(w, http.StatusUnprocessableEntity, "ansa couldn't hear the recording: is Whisper set up on this computer (docs/backend/try-it.md)? You can type instead.")
			return
		}
	}
	words, err := s.Phone.Turn(r.Context(), who.CompanyID, input.CallID, heard)
	switch {
	case errors.Is(err, phone.ErrCallOver):
		problem(w, http.StatusConflict, "This call is over. Start a new one.")
	case err != nil:
		s.failed(w, "practice call turn", err)
	default:
		writeJSON(w, http.StatusOK, map[string]any{"heard": heard, "words": words})
	}
}

// endPracticeCall: POST {callId}: hangs up (a request for messages it took).
func (s *Server) endPracticeCall(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		CallID string `json:"callId"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	if err := s.Phone.End(r.Context(), who.CompanyID, input.CallID); err != nil {
		s.failed(w, "practice call end", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{})
}
