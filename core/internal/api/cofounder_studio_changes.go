package api

import (
	"net/http"
	"strings"
	"time"

	"ansa/core/internal/contentrules"
	"ansa/core/internal/session"
	"ansa/core/internal/studio"
)

// A draft's changes (registered in cofounder_studio.go). Every one names
// the version the page showed: a draft changed since is refused, never
// overwritten unseen.

// editDraft: {version, topic, pillar, campaign, title, body, hashtags (as
// typed: "#bread #lisbon"), callToAction, imagePrompt, videoScript}.
func (s *Server) editDraft(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session, draftID string) {
	var input struct {
		studio.EditForm
		Version int `json:"version"`
	}
	if !readJSON(body, &input) || input.Version < 1 {
		problem(w, http.StatusBadRequest, "Unknown draft. Reload the page and try again.")
		return
	}
	placement, fields, problems := studio.CheckEdit(input.EditForm)
	if len(problems) > 0 {
		fieldProblems(w, problems)
		return
	}
	outcome, err := studio.Edit(r.Context(), s.Pool, who.CompanyID, who.UserID, draftID, input.Version, placement, fields)
	s.answerDraftChange(w, "draft edit", outcome, err)
}

// regenerateDraft: {version}: new text from the AI as the next version
// (waits for it). A page showing an older version is refused before the
// AI is asked. Counts against the company's AI drafts, not the changes.
func (s *Server) regenerateDraft(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	id := strings.ToLower(r.PathValue("id"))
	var input struct {
		Version int `json:"version"`
	}
	if !uuidPattern.MatchString(id) || !readJSON(body, &input) || input.Version < 1 {
		problem(w, http.StatusBadRequest, "Unknown draft. Reload the page and try again.")
		return
	}
	allowLongAnswer(w, 290*time.Second)
	result, err := s.Studio.Writer.Regenerate(r.Context(), who.CompanyID, who.UserID, id, input.Version)
	s.answerGeneration(w, result, err)
}

// approveDraft: {version, claimsChecked} (owners): only with no blocking
// issue, and with "I checked these claims" when a claim isn't backed.
func (s *Server) approveDraft(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session, draftID string) {
	var input struct {
		Version       int  `json:"version"`
		ClaimsChecked bool `json:"claimsChecked"`
	}
	if !readJSON(body, &input) || input.Version < 1 {
		problem(w, http.StatusBadRequest, "Unknown draft. Reload the page and try again.")
		return
	}
	result, err := studio.Approve(r.Context(), s.Pool, who.CompanyID, who.UserID, draftID, input.Version, input.ClaimsChecked)
	switch {
	case err != nil:
		s.failed(w, "draft approval", err)
	case result.Outcome == studio.Blocked:
		problem(w, http.StatusUnprocessableEntity, "This draft can't be approved yet: "+issueMessages(result.Issues))
	case result.Outcome == studio.ClaimsNotChecked:
		problem(w, http.StatusUnprocessableEntity, `Some claims aren't backed by a confirmed fact, or were never checked: read them, then tick "I checked these claims".`)
	case result.Outcome == studio.NotAllowed:
		problem(w, http.StatusForbidden, onlyOwnersDecide)
	default:
		s.answerDraftChange(w, "draft approval", result.Outcome, nil)
	}
}

// rejectDraft: {version, note} (owners; a blank note is none).
func (s *Server) rejectDraft(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session, draftID string) {
	var input struct {
		Version int    `json:"version"`
		Note    string `json:"note"`
	}
	if !readJSON(body, &input) || input.Version < 1 {
		problem(w, http.StatusBadRequest, "Unknown draft. Reload the page and try again.")
		return
	}
	note, noteProblem := studio.CheckRejectionNote(input.Note)
	if noteProblem != "" {
		fieldProblems(w, map[string]string{"note": noteProblem})
		return
	}
	outcome, err := studio.Reject(r.Context(), s.Pool, who.CompanyID, who.UserID, draftID, input.Version, note)
	if outcome == studio.NotAllowed {
		problem(w, http.StatusForbidden, onlyOwnersDecide)
		return
	}
	s.answerDraftChange(w, "draft rejection", outcome, err)
}

// archiveDraft: {} (anyone in the company).
func (s *Server) archiveDraft(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session, draftID string) {
	outcome, err := studio.Archive(r.Context(), s.Pool, who.CompanyID, who.UserID, draftID)
	s.answerDraftChange(w, "draft archive", outcome, err)
}

// restoreDraft: {} (anyone in the company).
func (s *Server) restoreDraft(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session, draftID string) {
	outcome, err := studio.Restore(r.Context(), s.Pool, who.CompanyID, who.UserID, draftID)
	s.answerDraftChange(w, "draft restore", outcome, err)
}

func issueMessages(issues []contentrules.Issue) string {
	messages := make([]string, len(issues))
	for i, issue := range issues {
		messages[i] = issue.Message
	}
	return strings.Join(messages, " ")
}

// answerGeneration answers the AI's outcome: the draft, or why not.
func (s *Server) answerGeneration(w http.ResponseWriter, result studio.Result, err error) {
	switch {
	case err != nil:
		s.failed(w, "draft generation", err)
	case result.Outcome == studio.Stale:
		// Changed since the page showed it (before or while the AI wrote).
		problem(w, http.StatusConflict, result.Refusal)
	case result.Refusal != "":
		problem(w, http.StatusUnprocessableEntity, result.Refusal)
	case result.Outcome == studio.Changed || result.Outcome == "created":
		writeJSON(w, http.StatusOK, map[string]string{"outcome": result.Outcome, "draftId": result.DraftID})
	case result.Outcome == studio.NotAllowed:
		problem(w, http.StatusForbidden, "You can't add drafts to this company.")
	default:
		s.answerDraftChange(w, "draft generation", result.Outcome, nil)
	}
}
