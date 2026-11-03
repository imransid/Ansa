package api

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"ansa/core/internal/comments"
	"ansa/core/internal/database"
	"ansa/core/internal/session"
	"ansa/core/internal/settings"
	"ansa/core/internal/tenant"
)

// Comments on the business's Facebook posts (core/internal/comments): the
// list and what ansa did with each, Send or Discard of a reply waiting in
// "Ask me first", and the switch.

const commentGone = "This comment isn't there any more. Reload the page."

// reviewFunc is Send or Discard of a waiting reply (core/internal/comments).
type reviewFunc func(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, commentRowID string) (string, error)

func (s *Server) registerComments(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/comments", s.withSession(s.listComments))
	routes.HandleFunc("POST /api/v1/comments/{id}/send", s.withSession(s.sendWaitingComment))
	routes.HandleFunc("POST /api/v1/comments/{id}/discard", s.withSession(s.discardWaitingComment))
	routes.HandleFunc("GET /api/v1/comments/settings", s.withSession(s.commentSettings))
	routes.HandleFunc("POST /api/v1/comments/settings", s.withSession(s.ownersOnly("Only owners change how ansa answers comments.", s.saveCommentSettings)))
	s.registerPracticeComments(routes)
}

// listComments: GET ?page=N, everyone in the company: {comments, total,
// page, pageSize, commentsOn}, newest first.
func (s *Server) listComments(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	asked, _ := strconv.Atoi(r.URL.Query().Get("page"))
	page := comments.ClampPage(asked)
	list, total, err := comments.List(r.Context(), s.Pool, s.Box, who.CompanyID, page)
	if err != nil {
		s.failed(w, "comments list", err)
		return
	}
	switches, err := comments.ReadSettings(r.Context(), s.Pool, who.CompanyID, who.IsOwner())
	if err != nil {
		s.failed(w, "comments list", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"comments": list, "total": total, "page": page, "pageSize": comments.PageSize, "commentsOn": switches.On})
}

// sendWaitingComment: POST {}: anyone in the company sends ansa's waiting
// reply as the AI wrote it. {"outcome": "sent" | "changed"} (no longer waiting).
func (s *Server) sendWaitingComment(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	s.reviewWaitingComment(w, r, body, who, comments.SendWaiting)
}

// discardWaitingComment: POST {}: nothing goes out. {"outcome": "discarded" | "changed"}.
func (s *Server) discardWaitingComment(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	s.reviewWaitingComment(w, r, body, who, comments.DiscardWaiting)
}

func (s *Server) reviewWaitingComment(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session, review reviewFunc) {
	var input struct{}
	id := strings.ToLower(r.PathValue("id"))
	if !readJSON(orEmpty(body), &input) || !uuidPattern.MatchString(id) {
		problem(w, http.StatusNotFound, commentGone)
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "inbox-changes", who.UserID, inboxChanges); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Too many changes. Try again in a few minutes.")
		return
	}
	outcome, err := review(r.Context(), s.Pool, who.CompanyID, who.UserID, id)
	switch {
	case err != nil:
		s.failed(w, "comment review", err)
	case outcome == comments.OutcomeNotAllowed:
		problem(w, http.StatusForbidden, "You can no longer work this company's comments.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": outcome})
	}
}

// commentSettings: GET, everyone: {on, canChange, pages: [{name, allowed}]}.
func (s *Server) commentSettings(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	view, err := comments.ReadSettings(r.Context(), s.Pool, who.CompanyID, who.IsOwner())
	if err != nil {
		s.failed(w, "comment settings", err)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

// saveCommentSettings: POST {"on": true | false}, owners of a business: {"outcome": "saved"}.
func (s *Server) saveCommentSettings(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		On *bool `json:"on"`
	}
	if !readJSON(body, &input) || input.On == nil {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	outcome, err := comments.SaveOn(r.Context(), s.Pool, who.CompanyID, who.UserID, *input.On)
	switch {
	case err != nil:
		s.failed(w, "comment settings", err)
	case outcome == comments.NotABusiness:
		problem(w, http.StatusConflict, "ansa answers comments for businesses: a personal account has no Facebook Page posts to answer.")
	case outcome != settings.Saved:
		problem(w, http.StatusForbidden, "Only owners change how ansa answers comments.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": "saved"})
	}
}
