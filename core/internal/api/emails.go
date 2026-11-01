package api

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"ansa/core/internal/inbound"
	"ansa/core/internal/session"
)

func (s *Server) registerEmails(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/emails", s.withSession(s.listEmails))
	routes.HandleFunc("POST /api/v1/emails/{id}/process-again", s.withSession(s.slowChange(s.processAgain)))
	routes.HandleFunc("POST /api/v1/emails/{id}/ticket-anyway", s.withSession(s.slowChange(s.ticketAnyway)))
}

// listEmails: GET /api/v1/emails?page=, everyone in the company.
func (s *Server) listEmails(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	lines, err := inbound.List(r.Context(), s.Pool, who.CompanyID, page)
	if err != nil {
		s.failed(w, "emails", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"lines": lines})
}

// processAgain: content unavailable, a processing error, or stuck. The filters apply.
func (s *Server) processAgain(r *http.Request, _ []byte, who *session.Session, id string) (string, error) {
	outcome, err := s.Inbound.Process(r.Context(), who.CompanyID, strings.ToLower(id), inbound.ClaimAgain, true)
	if outcome == inbound.NotClaimed && err == nil {
		return "This email can't be processed again now. Reload the page.", nil
	}
	return "", err
}

// ticketAnyway: what the filters skipped becomes a request (never ansa's own mail).
func (s *Server) ticketAnyway(r *http.Request, _ []byte, who *session.Session, id string) (string, error) {
	outcome, err := s.Inbound.Process(r.Context(), who.CompanyID, strings.ToLower(id), inbound.ClaimAnyway, false)
	if outcome == inbound.NotClaimed && err == nil {
		return "This email can't become a request now. Reload the page.", nil
	}
	return "", err
}

// slowChange is requestChange for an action that may wait for Resend and
// the AI (fetching the email, then its triage): it may answer later than
// the server's 30-second default.
func (s *Server) slowChange(action requestAction) handler {
	inner := s.requestChange(action)
	return func(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
		allowLongAnswer(w, 5*time.Minute)
		inner(w, r, body, who)
	}
}
