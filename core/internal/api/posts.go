package api

import (
	"net/http"
	"regexp"
	"time"

	"ansa/core/internal/autopost"
	"ansa/core/internal/brainclient"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
	"ansa/core/internal/settings"
)

// "Post one now": 5 an hour per company (each is a paid AI call, and a post).
var postsNow = ratelimit.Rule{MaxAttempts: 5, Window: time.Hour}

var clockPattern = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

func (s *Server) registerPosts(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/settings/posts", s.withSession(s.postsPage))
	routes.HandleFunc("POST /api/v1/settings/posts", s.withSession(s.ownersOnly("Only owners change Post for me.", s.savePosts)))
	routes.HandleFunc("POST /api/v1/settings/posts/now", s.withSession(s.postNow))
}

// postsPage: GET, everyone reads it: the switch, the Pages, the next three
// posting times and the newest 20 posts with where each is and why.
func (s *Server) postsPage(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	page, err := autopost.ReadPage(r.Context(), s.Pool, who.CompanyID, time.Now())
	if err != nil {
		s.failed(w, "posts page", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"page": page, "canManage": who.IsOwner(), "kindLabels": autopost.KindLabels, "skipReasons": autopost.SkipReasonText})
}

// savePosts: {enabled, frequency, time, mode, understood}. Automatic needs
// the owner's tick: posts go out without anyone approving each one.
func (s *Server) savePosts(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		Enabled    bool   `json:"enabled"`
		Frequency  string `json:"frequency"`
		Time       string `json:"time"`
		Mode       string `json:"mode"`
		Understood bool   `json:"understood"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	fields := map[string]string{}
	if input.Frequency != autopost.FrequencyDaily && input.Frequency != autopost.FrequencyThreeAWeek && input.Frequency != autopost.FrequencyWeekly {
		fields["frequency"] = "Choose how often."
	}
	if !clockPattern.MatchString(input.Time) {
		fields["time"] = "Choose a time."
	}
	if input.Mode != "automatic" && input.Mode != "ask_first" {
		fields["mode"] = "Choose Automatic or Ask me first."
	}
	if len(fields) == 0 && input.Enabled && input.Mode == "automatic" && !input.Understood {
		fields["understood"] = "Tick this to let ansa post without asking you each time, or choose Ask me first."
	}
	if len(fields) > 0 {
		fieldProblems(w, fields)
		return
	}
	choices := autopost.Choices{Enabled: input.Enabled, Frequency: input.Frequency, Clock: input.Time, Mode: input.Mode}
	outcome, err := autopost.Save(r.Context(), s.Pool, who.CompanyID, who.UserID, choices)
	switch {
	case err != nil:
		s.failed(w, "posts save", err)
	case outcome == "no-time-zone":
		problem(w, http.StatusConflict, "Set your time zone first (Settings → What it knows → Opening hours).")
	case outcome == "not-in-package":
		problem(w, http.StatusConflict, "Your package doesn't include posts this often: Business posts up to 3 times a week, Pro every day. See Billing.")
	case outcome != settings.Saved:
		problem(w, http.StatusForbidden, "Only owners change Post for me.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": "saved"})
	}
}

// postNow: "Post one now" (owners), written now and, in Automatic, sent
// right after the answer, as the queue's "Publish now" is. Waits for the AI
// (two tries at most).
func (s *Server) postNow(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	if !who.IsOwner() {
		problem(w, http.StatusForbidden, "Only owners can post.")
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "autopost-now", who.CompanyID.String(), postsNow); err != nil || over {
		problem(w, http.StatusTooManyRequests, "That's a lot of posts this hour. Try again later.")
		return
	}
	// Two AI answers at most (a second try on another kind of post).
	allowLongAnswer(w, 2*brainclient.AutopostWait+10*time.Second)
	outcome, err := s.Posts.PostNow(r.Context(), who.CompanyID, time.Now())
	switch {
	case err != nil:
		s.failed(w, "post now", err)
	case outcome.Outcome == "not-on":
		problem(w, http.StatusConflict, "Switch Post for me on first.")
	case outcome.Outcome == autopost.SlotSkipped || outcome.Outcome == "taken":
		problem(w, http.StatusUnprocessableEntity, "ansa couldn't write a post just now: the list below says why.")
	default:
		if len(outcome.JobIDs) > 0 {
			s.sendSoon(who, outcome.JobIDs)
		}
		writeJSON(w, http.StatusOK, map[string]string{"outcome": outcome.Outcome})
	}
}
