package api

import (
	"net/http"
	"strings"
	"time"

	"ansa/core/internal/profile"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
)

// "Suggest facts from knowledge" on the business profile (see
// docs/backend/modules/profile.md): owners only.

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
