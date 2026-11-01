package api

import (
	"net/http"
	"strconv"
	"time"

	"ansa/core/internal/profile"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
	"ansa/core/internal/strategy"
)

// The Co-Founder's marketing strategy (see docs/backend/modules/strategy.md).
// Members read everything; only owners make plans and change the setting.

// Plans: 10 an hour per company, counted only once a plan can be made.
var marketingPlans = ratelimit.Rule{MaxAttempts: 10, Window: time.Hour}

func (s *Server) registerCofounderStrategy(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/cofounder/strategy", s.withSession(s.strategyPage))
	routes.HandleFunc("GET /api/v1/cofounder/strategy/versions/{version}", s.withSession(s.strategyVersion))
	routes.HandleFunc("POST /api/v1/cofounder/strategy/plan", s.withSession(s.makePlan))
	routes.HandleFunc("POST /api/v1/cofounder/strategy/support-trends", s.withSession(s.ownersOnly("Only owners can change what the Co-Founder reads.", s.setSupportTrends)))
}

// strategyPage: GET, the current plan, the newest 50 versions, what a new
// plan still needs, and the support-trends setting.
func (s *Server) strategyPage(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	page, err := strategy.ReadPage(r.Context(), s.Pool, who.CompanyID)
	if err != nil {
		s.failed(w, "strategy page", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"strategy": page, "canManage": who.IsOwner()})
}

// strategyVersion: one version by its number (only a claim): 404 when the
// company has no such version.
func (s *Server) strategyVersion(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	version, err := strconv.Atoi(r.PathValue("version"))
	if err != nil || version < 1 || version > 1_000_000 {
		problem(w, http.StatusNotFound, "Plan version not found.")
		return
	}
	page, err := strategy.ReadVersionPage(r.Context(), s.Pool, who.CompanyID, version)
	switch {
	case err != nil:
		s.failed(w, "strategy version", err)
	case page == nil:
		problem(w, http.StatusNotFound, "Plan version not found.")
	default:
		writeJSON(w, http.StatusOK, page)
	}
}

// makePlan: {goalNote}: a new version made by the AI (owners). Waits for
// the AI: one long try of up to 270 seconds.
func (s *Server) makePlan(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		GoalNote string `json:"goalNote"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	note, trouble := profile.FormText(input.GoalNote, 1_000, "", "A note can be at most 1,000 characters.")
	if trouble != "" {
		fieldProblems(w, map[string]string{"goalNote": trouble})
		return
	}
	if !who.IsOwner() {
		problem(w, http.StatusForbidden, "Only owners can make a marketing plan.")
		return
	}
	if missing, err := strategy.MissingNow(r.Context(), s.Pool, who.CompanyID); err != nil || len(missing) > 0 {
		s.planNotReady(w, missing, err)
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "marketing-plans", who.CompanyID.String(), marketingPlans); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Your company asked for a lot of plans this hour. Wait a while and try again.")
		return
	}
	allowLongAnswer(w, 295*time.Second)
	planner := &strategy.Planner{Pool: s.Pool, Brain: s.CofounderBrain, Log: s.Log}
	result, err := planner.Make(r.Context(), who.CompanyID, who.UserID, note)
	switch {
	case err != nil:
		s.failed(w, "marketing plan", err)
	case result.Outcome == strategy.NotReady:
		s.planNotReady(w, result.Missing, nil)
	case result.Outcome == profile.NotAllowed:
		problem(w, http.StatusForbidden, "Only owners can make a marketing plan.")
	case result.Outcome == strategy.NoPlan:
		problem(w, http.StatusBadGateway, noPlanWords[result.Problem])
	default:
		writeJSON(w, http.StatusOK, map[string]int{"version": result.Version})
	}
}

// Why no plan came back, in plain words: never a setting or an error's text.
var noPlanWords = map[string]string{
	strategy.ProblemUnavailable: "The AI isn't available right now, so no plan was made. Try again later.",
	strategy.ProblemUnusable:    "The AI's plan came back in a form that can't be used, so nothing was saved. Try again.",
	strategy.ProblemFailed:      "The AI couldn't write a plan just now, so nothing was saved. Try again in a few minutes.",
}

// planNotReady says which confirmed facts a plan still needs.
func (s *Server) planNotReady(w http.ResponseWriter, missing []strategy.MissingFact, err error) {
	if err != nil {
		s.failed(w, "marketing plan", err)
		return
	}
	labels := ""
	for index, fact := range missing {
		if index > 0 {
			labels += ", "
		}
		labels += fact.Label
	}
	writeJSON(w, http.StatusConflict, map[string]any{
		"error":   "A plan needs these facts confirmed first: " + labels + ". Confirm or fill them in on the Profile page.",
		"missing": missing,
	})
}

// setSupportTrends: {useSupportTrends}: whether plans may read ticket
// counts per category (owners, settings-changes limit).
func (s *Server) setSupportTrends(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		UseSupportTrends bool `json:"useSupportTrends"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "The setting could not be read. Reload the page and try again.")
		return
	}
	outcome, err := strategy.SetSupportTrends(r.Context(), s.Pool, who.CompanyID, who.UserID, input.UseSupportTrends)
	switch {
	case err != nil:
		s.failed(w, "support trends setting", err)
	case outcome == profile.NotAllowed:
		problem(w, http.StatusForbidden, "Only owners can change what the Co-Founder reads.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": outcome})
	}
}
