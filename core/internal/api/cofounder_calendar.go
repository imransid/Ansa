package api

import (
	"net/http"
	"time"

	"ansa/core/internal/calendar"
	"ansa/core/internal/hours"
	"ansa/core/internal/profile"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
)

// The Co-Founder's calendar (see docs/backend/modules/calendar.md).
// Everyone reads it; only owners plan the next 2 weeks with the AI.

// Calendar plans: 10 an hour per company (each is a paid AI call).
var calendarPlans = ratelimit.Rule{MaxAttempts: 10, Window: time.Hour}

func (s *Server) registerCofounderCalendar(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/cofounder/calendar", s.withSession(s.calendarPage))
	routes.HandleFunc("POST /api/v1/cofounder/calendar/plan", s.withSession(s.planCalendar))
}

// calendarPage: GET, the posts (not canceled) and the drafts planned for a
// day, from a day ago to a day past the 28 days; the browser puts each on
// the viewer's own day.
func (s *Server) calendarPage(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	page, err := calendar.ReadPage(r.Context(), s.Pool, who.CompanyID, who.IsOwner(), time.Now())
	if err != nil {
		s.failed(w, "calendar page", err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// planCalendar: {timeZone}: the browser names its own; the ideas are
// planned at local times in it (owners). Waits for the AI (up to about 3 minutes).
func (s *Server) planCalendar(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		TimeZone string `json:"timeZone"`
	}
	if !readJSON(body, &input) || !hours.KnownTimeZone(input.TimeZone) {
		problem(w, http.StatusBadRequest, "Your browser didn't say its timezone. Reload the page and try again.")
		return
	}
	zone, err := time.LoadLocation(input.TimeZone)
	if err != nil {
		problem(w, http.StatusBadRequest, "Your browser didn't say its timezone. Reload the page and try again.")
		return
	}
	if !who.IsOwner() {
		problem(w, http.StatusForbidden, "Only owners plan the calendar with the AI.")
		return
	}
	if plan, _, err := calendar.CurrentPlan(r.Context(), s.Pool, who.CompanyID); err != nil || plan == nil {
		s.noCurrentPlan(w, err)
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "calendar-plans", who.CompanyID.String(), calendarPlans); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Your company asked the AI to plan the calendar a lot this hour. Wait a while and try again.")
		return
	}
	allowLongAnswer(w, 240*time.Second)
	planner := &calendar.Planner{Pool: s.Pool, Brain: s.CofounderBrain, Log: s.Log}
	result, err := planner.PlanTwoWeeks(r.Context(), who.CompanyID, who.UserID, zone, time.Now())
	switch {
	case err != nil:
		s.failed(w, "calendar plan", err)
	case result.Outcome == calendar.NoCurrentPlan:
		s.noCurrentPlan(w, nil)
	case result.Outcome == profile.NotAllowed:
		problem(w, http.StatusForbidden, "Only owners plan the calendar with the AI.")
	case result.Outcome == calendar.NothingAdded:
		problem(w, http.StatusBadGateway, nothingAddedWords[result.Problem])
	default:
		writeJSON(w, http.StatusOK, map[string]int{"added": result.Added})
	}
}

func (s *Server) noCurrentPlan(w http.ResponseWriter, err error) {
	if err != nil {
		s.failed(w, "calendar plan", err)
		return
	}
	problem(w, http.StatusConflict, "There is no marketing plan yet: make one on the Strategy page first. The calendar is planned from its content pillars and how often to post.")
}

// Why nothing was planned, in plain words: never a setting or an error's text.
var nothingAddedWords = map[string]string{
	calendar.ProblemUnavailable: "The AI isn't available right now, so nothing was planned. Try again later, or start drafts yourself in the studio.",
	calendar.ProblemUnusable:    "The AI's plan came back in a form that can't be used, so nothing was added. Try again.",
	calendar.ProblemNoneFit:     "The AI's plan held no post that fits your plan's platforms and these days, so nothing was added. Try again.",
	calendar.ProblemFailed:      "The AI couldn't plan the calendar just now, so nothing was added. Try again in a few minutes.",
}
