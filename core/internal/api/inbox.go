package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"ansa/core/internal/inbox"
	"ansa/core/internal/logging"
	"ansa/core/internal/session"
)

// What each refusal says (the old screens' words).
var inboxRefusals = map[string]string{
	inbox.NotFound:   "This conversation isn't there any more. Reload the page.",
	inbox.NotAllowed: "You can no longer work this company's conversations.",
	inbox.NotWaiting: "This reply was already sent or discarded. Reload the page.",
	inbox.OwnersOnly: "Only owners can make ansa answer now.",
	inbox.NotDue:     "ansa isn't waiting to answer here any more. Reload the page.",
	developmentOnly:  answerNowOnly,
	"not-chat":       "Calls and emails can't be answered from ansa yet.",
	"not-connected":  "This chat's channel isn't connected. Connect it in Settings → Connections.",
	"cannot-reply":   "ansa isn't allowed to reply on this channel. Allow it in Settings → Connections.",
	"window-closed":  "ansa can reply only within 24 hours of the customer's last message. Answer them in your own app instead.",
}

func (s *Server) registerInbox(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/inbox", s.withSession(s.listInbox))
	routes.HandleFunc("GET /api/v1/activity", s.withSession(s.ansasActivity))
	routes.HandleFunc("GET /api/v1/conversations/{id}", s.withSession(s.conversationPage))
	routes.HandleFunc("POST /api/v1/conversations/{id}/take-over", s.withSession(s.inboxChange(s.takeOver)))
	routes.HandleFunc("POST /api/v1/conversations/{id}/hand-back", s.withSession(s.inboxChange(s.handBack)))
	routes.HandleFunc("POST /api/v1/conversations/{id}/important", s.withSession(s.inboxChange(s.setImportant)))
	routes.HandleFunc("POST /api/v1/conversations/{id}/reply", s.withSession(s.inboxChange(s.reply)))
	routes.HandleFunc("POST /api/v1/conversations/{id}/drafts/{message}/send", s.withSession(s.inboxChange(s.sendDraft)))
	routes.HandleFunc("POST /api/v1/conversations/{id}/drafts/{message}/discard", s.withSession(s.inboxChange(s.discardDraft)))
	routes.HandleFunc("POST /api/v1/conversations/{id}/answer-now", s.withSession(s.inboxChange(s.answerNow)))
}

// listInbox: GET /api/v1/inbox?view=needs-you|all&page=N.
func (s *Server) listInbox(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	view := r.URL.Query().Get("view")
	if view != inbox.ViewAll {
		view = inbox.ViewNeedsYou
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	rows, err := inbox.List(r.Context(), s.Pool, s.Box, who.CompanyID, view, page)
	if err != nil {
		s.failed(w, "inbox list", err)
		return
	}
	counts, err := inbox.Counts(r.Context(), s.Pool, who.CompanyID)
	if err != nil {
		s.failed(w, "inbox counts", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"rows": rows, "counts": counts})
}

// ansasActivity: GET /api/v1/activity, Home's "What ansa did" (newest 6).
func (s *Server) ansasActivity(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	lines, err := inbox.ListActivity(r.Context(), s.Pool, who.CompanyID, "", 6)
	if err != nil {
		s.failed(w, "activity", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"lines": lines})
}

// conversationPage: GET /api/v1/conversations/{id}.
func (s *Server) conversationPage(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	id := strings.ToLower(r.PathValue("id"))
	if !uuidPattern.MatchString(id) {
		problem(w, http.StatusNotFound, inboxRefusals[inbox.NotFound])
		return
	}
	page, err := inbox.ReadPage(r.Context(), s.Pool, s.Box, who.CompanyID, id)
	if errors.Is(err, inbox.ErrNotFound) {
		problem(w, http.StatusNotFound, inboxRefusals[inbox.NotFound])
		return
	}
	if err != nil {
		s.failed(w, "conversation page", err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		*inbox.Page
		// "Answer now" on a conversation ansa waits on (answer_now.go).
		CanAnswerNow bool `json:"canAnswerNow"`
	}{page, s.Development && who.IsOwner()})
}

// inboxAction is one change in a conversation: its outcome, or an error.
type inboxAction func(r *http.Request, body []byte, who *session.Session, conversationID string) (string, error)

// inboxChange checks the ids and the person's limit (120 changes per 10
// minutes), runs the change and answers {} or the refusal's words.
func (s *Server) inboxChange(action inboxAction) handler {
	return func(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
		id := strings.ToLower(r.PathValue("id"))
		message := r.PathValue("message")
		if !uuidPattern.MatchString(id) || (message != "" && !uuidPattern.MatchString(message)) {
			problem(w, http.StatusNotFound, inboxRefusals[inbox.NotFound])
			return
		}
		over, err := s.Limiter.Over(r.Context(), "inbox-changes", who.UserID, inboxChanges)
		if err != nil || over {
			problem(w, http.StatusTooManyRequests, "Too many changes. Try again in a few minutes.")
			return
		}
		outcome, err := action(r, body, who, id)
		var words wordsForPeople
		switch {
		case errors.As(err, &words):
			problem(w, http.StatusBadRequest, string(words))
		case err != nil:
			s.failed(w, "inbox change", err)
		case outcome == inbox.Saved || outcome == inbox.Unchanged:
			writeJSON(w, http.StatusOK, map[string]string{})
		default:
			problem(w, statusFor(outcome), inboxRefusals[outcome])
		}
	}
}

// wordsForPeople is a refusal whose words the action chose itself (what is
// wrong with a typed reply).
type wordsForPeople string

func (w wordsForPeople) Error() string { return string(w) }

func statusFor(outcome string) int {
	switch outcome {
	case inbox.NotFound:
		return http.StatusNotFound
	case inbox.NotAllowed, inbox.OwnersOnly, developmentOnly:
		return http.StatusForbidden
	}
	return http.StatusConflict
}

func (s *Server) takeOver(r *http.Request, body []byte, who *session.Session, id string) (string, error) {
	if !readJSON(orEmpty(body), &struct{}{}) {
		return inbox.NotFound, nil
	}
	return inbox.TakeOver(r.Context(), s.Pool, who.CompanyID, who.UserID, id)
}

func (s *Server) handBack(r *http.Request, body []byte, who *session.Session, id string) (string, error) {
	if !readJSON(orEmpty(body), &struct{}{}) {
		return inbox.NotFound, nil
	}
	return inbox.HandBack(r.Context(), s.Pool, who.CompanyID, who.UserID, id)
}

func (s *Server) setImportant(r *http.Request, body []byte, who *session.Session, id string) (string, error) {
	var input struct {
		Important *bool `json:"important"`
	}
	if !readJSON(body, &input) || input.Important == nil {
		return inbox.NotFound, nil
	}
	return inbox.SetImportant(r.Context(), s.Pool, who.CompanyID, who.UserID, id, *input.Important)
}

func (s *Server) reply(r *http.Request, body []byte, who *session.Session, id string) (string, error) {
	var input struct {
		Text            string `json:"text"`
		ReplacesDraftID string `json:"replacesDraftId"`
	}
	if !readJSON(body, &input) || (input.ReplacesDraftID != "" && !uuidPattern.MatchString(input.ReplacesDraftID)) {
		return inbox.NotFound, nil
	}
	text, problemText := inbox.CleanReply(input.Text)
	if problemText != "" {
		return "", wordsForPeople(problemText)
	}
	return s.Replies.Reply(r.Context(), who.CompanyID, who.UserID, id, text, strings.ToLower(input.ReplacesDraftID))
}

func (s *Server) sendDraft(r *http.Request, _ []byte, who *session.Session, id string) (string, error) {
	return s.Replies.SendDraft(r.Context(), who.CompanyID, who.UserID, id, strings.ToLower(r.PathValue("message")))
}

func (s *Server) discardDraft(r *http.Request, _ []byte, who *session.Session, id string) (string, error) {
	return s.Replies.DiscardDraft(r.Context(), who.CompanyID, who.UserID, id, strings.ToLower(r.PathValue("message")))
}

// orEmpty: a POST without a body counts as {}.
func orEmpty(body []byte) []byte {
	if len(body) == 0 {
		return []byte("{}")
	}
	return body
}

// failed answers 500 and logs the error's type only.
func (s *Server) failed(w http.ResponseWriter, what string, err error) {
	s.Log.Error("api: "+what+" failed", logging.ErrorType(err))
	w.WriteHeader(http.StatusInternalServerError)
}
