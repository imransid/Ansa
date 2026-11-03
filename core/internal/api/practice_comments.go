package api

import (
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"ansa/core/internal/comments"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/session"
)

// The practice comment box (development only, owners): an owner writes a
// comment as a made-up person under a post of the company's stand-in
// Facebook Page, saved through the same path as a comment from Meta's
// webhook (core/internal/comments), and sees what ansa did with it.

func (s *Server) registerPracticeComments(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/practice/comment/posts", s.withSession(s.withPracticeChat(s.practiceCommentPosts)))
	routes.HandleFunc("POST /api/v1/practice/comment", s.withSession(s.withPracticeChat(s.sendPracticeComment)))
	routes.HandleFunc("GET /api/v1/practice/comment/{commentId}", s.withSession(s.withPracticeChat(s.readPracticeComment)))
}

// practiceCommentPosts: GET: {posts: [{id, text}]}, the stand-in Page's
// newest published posts (or ansa's fixed stand-in post).
func (s *Server) practiceCommentPosts(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	posts, err := comments.PracticePosts(r.Context(), s.Pool, who.CompanyID)
	if err != nil {
		s.failed(w, "practice comment", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"posts": posts})
}

// sendPracticeComment: POST {postId, name, text}: {commentId}.
func (s *Server) sendPracticeComment(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		PostID string `json:"postId"`
		Name   string `json:"name"`
		Text   string `json:"text"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	name := strings.TrimSpace(plaintext.SingleLine(input.Name))
	text := strings.TrimSpace(strings.ReplaceAll(input.Text, "\x00", ""))
	fields := map[string]string{}
	if input.PostID == "" || len(input.PostID) > 200 {
		fields["postId"] = "Pick a post."
	}
	if name == "" || utf8.RuneCountInString(name) > 100 {
		fields["name"] = "Write the name of who comments (up to 100 characters)."
	}
	if text == "" || utf8.RuneCountInString(text) > 2000 {
		fields["text"] = "Write a comment (up to 2,000 characters)."
	}
	if len(fields) > 0 {
		fieldProblems(w, fields)
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "practice-comments", who.CompanyID.String(), practiceChatMessages); err != nil || over {
		problem(w, http.StatusTooManyRequests, "That's a lot of practice comments this hour. Try again later.")
		return
	}
	id, err := comments.SavePractice(r.Context(), s.Pool, s.Box, who.CompanyID, input.PostID, name, text)
	switch {
	case errors.Is(err, comments.ErrNoStandInPage):
		problem(w, http.StatusConflict, "Connect a stand-in Facebook Page on Settings → Connections first.")
	case errors.Is(err, comments.ErrUnknownPost):
		fieldProblems(w, map[string]string{"postId": "Pick one of the posts."})
	case err != nil:
		s.failed(w, "practice comment", err)
	default:
		writeJSON(w, http.StatusOK, map[string]string{"commentId": id})
	}
}

// practiceComment is one comment as the list shows it, and whether ansa is
// still answering it ("answering") or "done".
type practiceComment struct {
	comments.View
	Next string `json:"next"`
}

// readPracticeComment: GET: the comment (the company's own only) and next.
func (s *Server) readPracticeComment(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	id := strings.ToLower(r.PathValue("commentId"))
	if !uuidPattern.MatchString(id) {
		problem(w, http.StatusNotFound, commentGone)
		return
	}
	view, err := comments.ReadOne(r.Context(), s.Pool, s.Box, who.CompanyID, id)
	switch {
	case errors.Is(err, comments.ErrNotFound):
		problem(w, http.StatusNotFound, commentGone)
	case err != nil:
		s.failed(w, "practice comment", err)
	default:
		next := "done"
		if view.Status == comments.StatusNew {
			next = "answering"
		}
		writeJSON(w, http.StatusOK, practiceComment{View: *view, Next: next})
	}
}
