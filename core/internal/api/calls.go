package api

import (
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"
	"time"

	"ansa/core/internal/calls"
	"ansa/core/internal/logging"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
)

// The Calls page and a call's page. Anyone in the company reads, analyzes
// and escalates calls, as they work requests.

// Each analysis is a paid AI request: 20 per 10 minutes per person; 200
// recording plays per 10 minutes per person (each a signed link).
var (
	callAnalyses   = ratelimit.Rule{MaxAttempts: 20, Window: 10 * time.Minute}
	recordingViews = ratelimit.Rule{MaxAttempts: 200, Window: 10 * time.Minute}
)

const (
	callGone               = "That call was not found in your company."
	escalationNoteMaxRunes = 2_000
	recordingLinkSeconds   = 5 * 60
)

func (s *Server) registerCalls(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/calls", s.withSession(s.listCalls))
	routes.HandleFunc("GET /api/v1/calls/{id}", s.withSession(s.callPage))
	routes.HandleFunc("POST /api/v1/calls/{id}/analyze", s.withSession(s.analyzeCallNow))
	routes.HandleFunc("POST /api/v1/calls/{id}/escalate", s.withSession(s.escalateCall))
	routes.HandleFunc("GET /api/v1/calls/{id}/recording", s.withSession(s.callRecording))
}

// listCalls: GET /api/v1/calls?outcome=&q=&page=.
func (s *Server) listCalls(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	query := r.URL.Query()
	outcome := query.Get("outcome")
	if !calls.IsOutcomeFilter(outcome) {
		outcome = "all"
	}
	q := query.Get("q")
	if len(q) > 200 {
		q = q[:200]
	}
	page, _ := strconv.Atoi(query.Get("page"))
	list, err := calls.List(r.Context(), s.Pool, who.CompanyID, outcome, q, page)
	if err != nil {
		s.failed(w, "calls", err)
		return
	}
	counts, err := calls.Counts(r.Context(), s.Pool, who.CompanyID, q)
	if err != nil {
		s.failed(w, "call counts", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"outcome": outcome, "calls": list, "counts": counts})
}

// callPage: GET /api/v1/calls/{id}: the call, the knowledge the assistant
// looked up during it, and the categories for "Escalate to a ticket".
func (s *Server) callPage(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	id := strings.ToLower(r.PathValue("id"))
	if !uuidPattern.MatchString(id) {
		problem(w, http.StatusNotFound, callGone)
		return
	}
	call, err := calls.Find(r.Context(), s.Pool, s.Box, who.CompanyID, id)
	if err != nil || call == nil {
		if err != nil {
			s.failed(w, "call", err)
			return
		}
		problem(w, http.StatusNotFound, callGone)
		return
	}
	lookups, more, err := calls.Lookups(r.Context(), s.Pool, who.CompanyID, id)
	if err != nil {
		s.failed(w, "call lookups", err)
		return
	}
	categories, err := calls.Categories(r.Context(), s.Pool, who.CompanyID)
	if err != nil {
		s.failed(w, "categories", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"call": call, "lookups": lookups, "moreLookupsNotShown": more, "categories": categories})
}

// analyzeCallNow: "Analyze now" on a call never analyzed, or stuck. The
// answer waits for the AI (up to 60 s a try, 2 retries).
func (s *Server) analyzeCallNow(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	allowLongAnswer(w, 270*time.Second)
	id := strings.ToLower(r.PathValue("id"))
	if !uuidPattern.MatchString(id) {
		problem(w, http.StatusNotFound, "Unknown call.")
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "call-analysis", who.UserID, callAnalyses); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Too many analyses. Try again in a few minutes.")
		return
	}
	outcome, err := s.Calls.Analyze(r.Context(), who.CompanyID, id)
	switch {
	case err != nil || outcome == "failed":
		if err != nil {
			s.Log.Error("api: call analysis failed", logging.ErrorType(err))
		}
		problem(w, http.StatusServiceUnavailable, "The analysis failed and nothing could be saved. Try again in a few minutes.")
	case outcome == "not-claimed":
		problem(w, http.StatusConflict, "This call is already analyzed or being analyzed.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": "decided"})
	}
}

// escalateCall: {categoryId, note}: the call's request, routed as any new
// request (the ticket-creations limit, shared with New request).
func (s *Server) escalateCall(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	id := strings.ToLower(r.PathValue("id"))
	var input struct {
		CategoryID string `json:"categoryId"`
		Note       string `json:"note"`
	}
	if !uuidPattern.MatchString(id) || !readJSON(body, &input) || (input.CategoryID != "" && !uuidPattern.MatchString(input.CategoryID)) {
		problem(w, http.StatusBadRequest, callGone)
		return
	}
	note, why := plaintext.Note(input.Note, escalationNoteMaxRunes)
	if why != "" {
		fieldProblems(w, map[string]string{"note": why})
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "ticket-creations", who.UserID, ticketCreations); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Too many new tickets. Try again in a few minutes.")
		return
	}
	number, err := calls.Escalate(r.Context(), s.Pool, s.Box, who.CompanyID, who.UserID, id, strings.ToLower(input.CategoryID), note)
	switch {
	case err != nil:
		s.failed(w, "call escalation", err)
	case number == 0:
		problem(w, http.StatusConflict, "Only a call the AI marked solved, without a ticket yet, can be escalated. Someone may have just done it.")
	default:
		writeJSON(w, http.StatusOK, map[string]int{"ticketNumber": number})
	}
}

// callRecording: {"url"} (a 5-minute signed link) or, in development,
// {"contentType", "data": base64}. Too many plays answer 429, never 404.
func (s *Server) callRecording(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	id := strings.ToLower(r.PathValue("id"))
	if !uuidPattern.MatchString(id) {
		problem(w, http.StatusNotFound, "No recording.")
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "recording-views", who.UserID, recordingViews); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Too many plays. Try again in a few minutes.")
		return
	}
	key, contentType, found, err := calls.StoredRecording(r.Context(), s.Pool, who.CompanyID, id)
	if err != nil || !found {
		if err != nil {
			s.failed(w, "recording", err)
			return
		}
		problem(w, http.StatusNotFound, "No recording.")
		return
	}
	access, found, err := s.Files.Reach(r.Context(), key, contentType, recordingLinkSeconds, "")
	switch {
	case err != nil:
		s.failed(w, "recording", err)
	case !found:
		problem(w, http.StatusNotFound, "No recording.")
	case access.SignedURL != "":
		writeJSON(w, http.StatusOK, map[string]string{"url": access.SignedURL})
	default:
		writeJSON(w, http.StatusOK, map[string]string{"contentType": contentType, "data": base64.StdEncoding.EncodeToString(access.Bytes)})
	}
}
