package api

import (
	"net/http"
	"strings"
	"time"

	"ansa/core/internal/profile"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
)

// The Co-Founder's business profile (see docs/backend/modules/profile.md).
// Members read it; only owners confirm, dismiss and edit (checked here for
// a clear answer, and again inside the write's transaction).

// Confirming, editing, dismissing and Start over: 120 per 10 minutes per person.
var businessProfileChanges = ratelimit.Rule{MaxAttempts: 120, Window: 10 * time.Minute}

const staleEdit = "Someone changed this fact after you opened it, so your change was not saved. Copy your text, reload the page and make your change again."

func (s *Server) registerCofounderProfile(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/cofounder/profile", s.withSession(s.cofounderProfile))
	routes.HandleFunc("POST /api/v1/cofounder/profile/confirm", s.withSession(s.confirmFact))
	routes.HandleFunc("POST /api/v1/cofounder/profile/dismiss", s.withSession(s.dismissProposal))
	routes.HandleFunc("POST /api/v1/cofounder/profile/edit", s.withSession(s.editFact))
	routes.HandleFunc("POST /api/v1/cofounder/profile/suggest", s.withSession(s.suggestFacts))
	s.registerCofounderInterview(routes)
}

// profileService is the interview and the suggestions, with the brain they ask.
func (s *Server) profileService() *profile.Service {
	return &profile.Service{Pool: s.Pool, Box: s.Box, Brain: s.CofounderBrain, Log: s.Log}
}

// cofounderProfile: GET, everyone reads it: every topic, how complete it
// is, and (owners) the approved articles "Suggest facts" may read.
func (s *Server) cofounderProfile(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	page, err := profile.ReadPage(r.Context(), s.Pool, who.CompanyID)
	if err != nil {
		s.failed(w, "cofounder profile", err)
		return
	}
	articles := []profile.ArticleChoice{}
	if who.IsOwner() {
		if articles, err = profile.ArticlesForSuggestions(r.Context(), s.Pool, who.CompanyID); err != nil {
			s.failed(w, "cofounder profile", err)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": page, "canManage": who.IsOwner(), "articlesForSuggestions": articles})
}

// ownerWithinProfileLimit: owners only, within the business-profile-changes limit.
func (s *Server) ownerWithinProfileLimit(w http.ResponseWriter, r *http.Request, who *session.Session, refusal string) bool {
	if !who.IsOwner() {
		problem(w, http.StatusForbidden, refusal)
		return false
	}
	if over, err := s.Limiter.Over(r.Context(), "business-profile-changes", who.UserID, businessProfileChanges); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Too many changes. Try again in a few minutes.")
		return false
	}
	return true
}

// shownProposal reads a value the page showed: only a claim, compared in
// the write with the stored one ("" fine only where it may be none).
func shownProposal(topic, shown string) (string, bool) {
	value := profile.ShownValue(shown)
	_, known := profile.FindTopic(topic)
	return value, known && value != "" && profile.UTF16Length(value) <= profile.FactMaxLength
}

// confirmFact: {topic, shownProposal, shownConfirmedValue, value?}: Confirm
// (no value: the proposal as shown) or Edit and confirm.
func (s *Server) confirmFact(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		Topic               string  `json:"topic"`
		ShownProposal       string  `json:"shownProposal"`
		ShownConfirmedValue string  `json:"shownConfirmedValue"`
		Value               *string `json:"value"`
	}
	shown, ok := "", readJSON(body, &input)
	if ok {
		shown, ok = shownProposal(input.Topic, input.ShownProposal)
	}
	if !ok || profile.UTF16Length(input.ShownConfirmedValue) > profile.FactMaxLength {
		problem(w, http.StatusBadRequest, "Unknown topic or proposal. Reload the page and try again.")
		return
	}
	value := shown
	if input.Value != nil {
		typed, trouble := profile.FormText(*input.Value, profile.FactMaxLength, "Write the fact first.", "A fact can be at most 2,000 characters.")
		if trouble != "" {
			fieldProblems(w, map[string]string{"value": trouble})
			return
		}
		value = typed
	}
	if !s.ownerWithinProfileLimit(w, r, who, "Only owners can change the business profile.") {
		return
	}
	outcome, err := profile.Confirm(r.Context(), s.Pool, who.CompanyID, who.UserID, input.Topic, shown, profile.ShownValue(input.ShownConfirmedValue), value)
	s.factOutcome(w, outcome, err, "This proposal, or the fact beside it, changed or was handled meanwhile, so nothing was confirmed. Reload the page to see it.")
}

// dismissProposal: {topic, shownProposal}.
func (s *Server) dismissProposal(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		Topic         string `json:"topic"`
		ShownProposal string `json:"shownProposal"`
	}
	shown, ok := "", readJSON(body, &input)
	if ok {
		shown, ok = shownProposal(input.Topic, input.ShownProposal)
	}
	if !ok {
		problem(w, http.StatusBadRequest, "Unknown proposal.")
		return
	}
	if !s.ownerWithinProfileLimit(w, r, who, "Only owners can change the business profile.") {
		return
	}
	outcome, err := profile.Dismiss(r.Context(), s.Pool, who.CompanyID, who.UserID, input.Topic, shown)
	s.factOutcome(w, outcome, err, "This proposal changed or was handled meanwhile, so nothing was dismissed. Reload the page to see it.")
}

// editFact: {topic, value, originalValue}: Edit or Fill in, confirmed at once.
func (s *Server) editFact(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		Topic         string `json:"topic"`
		Value         string `json:"value"`
		OriginalValue string `json:"originalValue"`
	}
	read := readJSON(body, &input)
	if _, known := profile.FindTopic(input.Topic); !read || !known || profile.UTF16Length(input.OriginalValue) > profile.FactMaxLength {
		problem(w, http.StatusBadRequest, "Unknown topic or proposal. Reload the page and try again.")
		return
	}
	value, trouble := profile.FormText(input.Value, profile.FactMaxLength, "Write the fact first.", "A fact can be at most 2,000 characters.")
	if trouble != "" {
		fieldProblems(w, map[string]string{"value": trouble})
		return
	}
	if !s.ownerWithinProfileLimit(w, r, who, "Only owners can change the business profile.") {
		return
	}
	outcome, err := profile.SaveValue(r.Context(), s.Pool, who.CompanyID, who.UserID, input.Topic, profile.ShownValue(input.OriginalValue), value)
	s.factOutcome(w, outcome, err, staleEdit)
}

// factOutcome answers a change of a fact: {"outcome": "changed" | "unchanged"}.
func (s *Server) factOutcome(w http.ResponseWriter, outcome string, err error, staleMessage string) {
	switch {
	case err != nil:
		s.failed(w, "cofounder fact change", err)
	case outcome == profile.NotAllowed:
		problem(w, http.StatusForbidden, "Only owners can change the business profile.")
	case outcome == profile.Stale:
		problem(w, http.StatusConflict, staleMessage)
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": outcome})
	}
}

// Suggestions: 20 an hour per company (each is a paid AI call).
var factSuggestions = ratelimit.Rule{MaxAttempts: 20, Window: time.Hour}

// suggestFacts: {articleId}: the AI reads one approved article (owners).
func (s *Server) suggestFacts(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		ArticleID string `json:"articleId"`
	}
	if !readJSON(body, &input) || !uuidPattern.MatchString(input.ArticleID) {
		fieldProblems(w, map[string]string{"articleId": "Pick an article first."})
		return
	}
	if !who.IsOwner() {
		problem(w, http.StatusForbidden, "Only owners can ask for suggestions.")
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "fact-suggestions", who.CompanyID.String(), factSuggestions); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Your company asked for a lot of suggestions this hour. Wait a while and try again.")
		return
	}
	allowLongAnswer(w, 150*time.Second)
	result, err := s.profileService().Suggest(r.Context(), who.CompanyID, who.UserID, strings.ToLower(input.ArticleID))
	switch {
	case err != nil:
		s.failed(w, "fact suggestions", err)
	case result.Outcome == profile.ArticleNotFound:
		problem(w, http.StatusNotFound, "That article is not an approved article of your company. Reload the page and pick another.")
	case result.Outcome == profile.ArticleNotForAI:
		problem(w, http.StatusConflict, "That article is ticked for neither support nor marketing, so no AI may read it. Tick one on its Knowledge page, or pick another.")
	case result.Outcome == profile.NoAnswer:
		problem(w, http.StatusBadGateway, "The AI couldn't read the article just now, so nothing was proposed. Try again later.")
	case result.Outcome == profile.NotAllowed:
		problem(w, http.StatusForbidden, "Only owners can ask for suggestions.")
	default:
		writeJSON(w, http.StatusOK, result)
	}
}
