package api

import (
	"net/http"
	"time"

	"ansa/core/internal/analytics"
	"ansa/core/internal/session"
)

// The Co-Founder's Analytics page (see docs/backend/modules/analytics.md):
// everyone in the company reads it; owners ask for a performance review.

func (s *Server) registerAnalytics(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/cofounder/analytics", s.withSession(s.analyticsPage))
	routes.HandleFunc("POST /api/v1/cofounder/analytics/review", s.withSession(s.reviewPerformance))
}

// analyticsPage: GET ?period=7|30|90 (anything else is 30).
func (s *Server) analyticsPage(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	period := analytics.ParsePeriod(r.URL.Query()["period"])
	page, err := analytics.ReadPage(r.Context(), s.Pool, who.CompanyID, who.IsOwner(), period, time.Now())
	if err != nil {
		s.failed(w, "analytics page", err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// The answer's status for each way a review request can end.
var reviewStatuses = map[string]int{
	analytics.Invalid:     http.StatusBadRequest,
	analytics.NotOwner:    http.StatusForbidden,
	analytics.TooFewPosts: http.StatusConflict,
	analytics.Limited:     http.StatusTooManyRequests,
	analytics.NoReview:    http.StatusUnprocessableEntity,
}

// reviewPerformance: {period, timeZone} (the period the page showed, the
// browser's own time zone). Waits for the AI: two tries of up to 120 s.
func (s *Server) reviewPerformance(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		Period   string `json:"period"`
		TimeZone string `json:"timeZone"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	allowLongAnswer(w, 270*time.Second)
	outcome, err := s.Reviews.Review(r.Context(), who.CompanyID, who.UserID, who.IsOwner(), input.Period, input.TimeZone, time.Now())
	switch {
	case err != nil:
		s.failed(w, "performance review", err)
	case outcome.Code == analytics.Saved:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": analytics.Saved})
	default:
		problem(w, reviewStatuses[outcome.Code], outcome.Message)
	}
}
