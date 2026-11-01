package api

import (
	"net/http"
	"time"

	"ansa/core/internal/profile"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
)

// The Co-Founder's interview (see docs/backend/modules/profile.md). Members
// read it; only owners answer and start over.

// Answers: 60 an hour per company (every answer is a paid AI call).
var onboardingTurns = ratelimit.Rule{MaxAttempts: 60, Window: time.Hour}

func (s *Server) registerCofounderInterview(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/cofounder/interview", s.withSession(s.cofounderInterview))
	routes.HandleFunc("POST /api/v1/cofounder/interview/answer", s.withSession(s.answerInterview))
	routes.HandleFunc("POST /api/v1/cofounder/interview/start-over", s.withSession(s.startInterviewOver))
}

// cofounderInterview: GET, the newest 100 messages decrypted, the opening
// question while there is none, and whether it is finished.
func (s *Server) cofounderInterview(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	interview, err := s.profileService().ReadInterview(r.Context(), who.CompanyID)
	if err != nil {
		s.failed(w, "cofounder interview", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"interview": interview, "canAnswer": who.IsOwner()})
}

// answerInterview: {answer, openingTopic?}. openingTopic is sent only while
// the page shows the first question: the topic it asked about, or "none".
func (s *Server) answerInterview(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		Answer       string  `json:"answer"`
		OpeningTopic *string `json:"openingTopic"`
	}
	if !readJSON(body, &input) || !knownOpening(input.OpeningTopic) {
		problem(w, http.StatusBadRequest, "Your answer could not be sent. Reload the page and try again.")
		return
	}
	answer, trouble := profile.FormText(input.Answer, profile.AnswerMaxLength, "Type your answer first.", "An answer can be at most 4,000 characters.")
	if trouble != "" {
		fieldProblems(w, map[string]string{"answer": trouble})
		return
	}
	if !who.IsOwner() {
		problem(w, http.StatusForbidden, "Only owners answer the interview.")
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "onboarding-turns", who.CompanyID.String(), onboardingTurns); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Your company has answered a lot of questions this hour. Wait a while and try again.")
		return
	}
	opening := input.OpeningTopic
	if opening != nil && *opening == "none" {
		none := ""
		opening = &none
	}
	allowLongAnswer(w, 150*time.Second)
	result, err := s.profileService().Answer(r.Context(), who.CompanyID, who.UserID, answer, opening)
	switch {
	case err != nil:
		s.failed(w, "cofounder answer", err)
	case result.Outcome == profile.NotAllowed:
		problem(w, http.StatusForbidden, "Only owners answer the interview.")
	case result.Outcome == profile.StartedOver:
		problem(w, http.StatusConflict, "The interview was started over while you answered, so your answer was not saved. Reload the page to see its first question.")
	case result.Outcome == profile.StartedOverWhileReading:
		problem(w, http.StatusConflict, "The interview was started over while the AI read your answer, so nothing was saved from it.")
	default:
		writeJSON(w, http.StatusOK, result)
	}
}

// knownOpening: no opening, "none", or a topic of ours.
func knownOpening(topic *string) bool {
	if topic == nil || *topic == "none" {
		return true
	}
	_, known := profile.FindTopic(*topic)
	return known
}

// startInterviewOver: deletes the messages, never the facts (owners).
func (s *Server) startInterviewOver(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	if !s.ownerWithinProfileLimit(w, r, who, "Only owners can start the interview over.") {
		return
	}
	outcome, err := s.profileService().StartOver(r.Context(), who.CompanyID, who.UserID)
	switch {
	case err != nil:
		s.failed(w, "cofounder start over", err)
	case outcome == profile.NotAllowed:
		problem(w, http.StatusForbidden, "Only owners can start the interview over.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": "started-over"})
	}
}
