package api

import (
	"net/http"
	"time"

	"ansa/core/internal/home"
	"ansa/core/internal/inbox"
	"ansa/core/internal/orders"
	"ansa/core/internal/outbox"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
	"ansa/core/internal/settings"
)

// An owner's settings changes: 60 per 10 minutes (the old
// RATE_LIMITS.settingsChangesPerUser, the same counter).
var settingsChanges = ratelimit.Rule{MaxAttempts: 60, Window: 10 * time.Minute}

// How many conversations Home lists by name; the rest are one click away.
const needsYouShown = 5

func (s *Server) registerHome(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/home", s.withSession(s.homePage))
	routes.HandleFunc("GET /api/v1/glance", s.withSession(s.glance))
	routes.HandleFunc("POST /api/v1/home/away-summary/seen", s.withSession(s.awaySummarySeen))
	routes.HandleFunc("POST /api/v1/assistant/status", s.withSession(s.ownerSwitch("status")))
	routes.HandleFunc("POST /api/v1/assistant/away", s.withSession(s.ownerSwitch("away")))
	routes.HandleFunc("POST /api/v1/assistant/answer-when", s.withSession(s.ownerSwitch("answerWhen")))
}

// glance: GET /api/v1/glance, the sidebar's foot on every page: who you are,
// your company, what ansa does now and today's hours.
func (s *Server) glance(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	glance, err := home.ReadGlance(r.Context(), s.Pool, who.CompanyID, time.Now())
	if err != nil {
		s.failed(w, "glance", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"glance": glance, "userName": who.Name, "email": who.Email, "role": who.Role})
}

// homePage: GET /api/v1/home, everything Home shows (members read it too).
func (s *Server) homePage(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	ctx := r.Context()
	presence, err := home.ReadPresence(ctx, s.Pool, who.CompanyID, who.Role, time.Now())
	if err != nil {
		s.failed(w, "home presence", err)
		return
	}
	var brain home.BrainStatus
	if s.Brain != nil && who.IsOwner() {
		// The brain down = no AI is ready (nothing could answer anyway).
		_ = s.Brain.Call(ctx, "/v1/status", map[string]string{}, &brain)
	}
	page := map[string]any{"presence": presence}
	steps, err := home.GettingStarted(ctx, s.Pool, who.CompanyID, who.Role, brain)
	if err == nil {
		page["gettingStarted"] = steps
		if presence.AnswerWhen == "when_away" {
			page["awaySummary"], err = home.ReadAwaySummary(ctx, s.Pool, who.CompanyID, who.UserID)
		}
	}
	if err == nil {
		err = s.addNeedsYou(r, who, page)
	}
	if err == nil {
		err = s.addNumbers(r, who, page)
	}
	if err == nil && who.IsOwner() {
		page["package"], err = home.ReadPackageStatus(ctx, s.Pool, who.CompanyID, time.Now())
	}
	if err != nil {
		s.failed(w, "home", err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// addNeedsYou adds the newest conversations that need a person, how many
// new orders wait, and what ansa did.
func (s *Server) addNeedsYou(r *http.Request, who *session.Session, page map[string]any) error {
	ctx := r.Context()
	rows, err := inbox.List(ctx, s.Pool, s.Box, who.CompanyID, inbox.ViewNeedsYou, 1)
	if err != nil {
		return err
	}
	counts, err := inbox.Counts(ctx, s.Pool, who.CompanyID)
	if err != nil {
		return err
	}
	hasTeam, err := home.HasTeam(ctx, s.Pool, who.CompanyID)
	if err != nil {
		return err
	}
	page["needsYou"] = map[string]any{"rows": rows[:min(len(rows), needsYouShown)], "total": counts[inbox.ViewNeedsYou], "hasTeam": hasTeam}
	if page["newOrders"], err = orders.CountNew(ctx, s.Pool, who.CompanyID); err != nil {
		return err
	}
	page["activity"], err = inbox.ListActivity(ctx, s.Pool, who.CompanyID, "", 6)
	return err
}

// addNumbers adds the business's numbers, the customer emails never
// delivered, and whether this person handles no category.
func (s *Server) addNumbers(r *http.Request, who *session.Session, page map[string]any) error {
	ctx := r.Context()
	var err error
	if page["overview"], err = home.ReadOverview(ctx, s.Pool, who.CompanyID, who.Role, who.UserID); err != nil {
		return err
	}
	if page["undeliveredEmails"], err = outbox.CountUndelivered(ctx, s.Pool, who.CompanyID); err != nil {
		return err
	}
	page["handlesNoCategory"], err = home.HandlesNoCategory(ctx, s.Pool, who.CompanyID, who.UserID)
	return err
}

// awaySummarySeen: POST /api/v1/home/away-summary/seen ("Got it").
func (s *Server) awaySummarySeen(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	allowed, err := home.MarkAwaySummarySeen(r.Context(), s.Pool, who.CompanyID, who.UserID)
	switch {
	case err != nil:
		s.failed(w, "away summary", err)
	case !allowed:
		problem(w, http.StatusForbidden, "You can no longer work this company's conversations.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{})
	}
}

// ownerSwitch is one of the owner's switches on Home and Settings:
// {"status": "on"|"paused"}, {"away": bool} or {"answerWhen": "always"|"when_away"}.
func (s *Server) ownerSwitch(which string) handler {
	refusal := map[string]string{"status": "Only owners can pause or start ansa.", "away": "Only owners say when ansa answers.", "answerWhen": "Only owners say when ansa answers."}[which]
	return func(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
		var input struct {
			Status     string `json:"status"`
			Away       *bool  `json:"away"`
			AnswerWhen string `json:"answerWhen"`
		}
		valid := readJSON(body, &input) && map[string]bool{
			"status":     input.Status == "on" || input.Status == "paused",
			"away":       input.Away != nil,
			"answerWhen": input.AnswerWhen == "always" || input.AnswerWhen == "when_away",
		}[which]
		if !valid {
			problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
			return
		}
		if !who.IsOwner() {
			problem(w, http.StatusForbidden, refusal)
			return
		}
		if over, err := s.Limiter.Over(r.Context(), "settings-changes", who.UserID, settingsChanges); err != nil || over {
			problem(w, http.StatusTooManyRequests, "Too many changes. Try again in a few minutes.")
			return
		}
		var outcome string
		var err error
		switch which {
		case "status":
			outcome, err = settings.SetStatus(r.Context(), s.Pool, who.CompanyID, who.UserID, input.Status)
		case "away":
			outcome, err = settings.SetAway(r.Context(), s.Pool, who.CompanyID, who.UserID, *input.Away)
		default:
			outcome, err = settings.SetAnswerWhen(r.Context(), s.Pool, who.CompanyID, who.UserID, input.AnswerWhen)
		}
		switch {
		case err != nil:
			s.failed(w, "owner switch", err)
		case outcome != settings.Saved:
			problem(w, http.StatusForbidden, refusal)
		default:
			writeJSON(w, http.StatusOK, map[string]string{})
		}
	}
}
