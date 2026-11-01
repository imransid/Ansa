package api

import (
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"ansa/core/internal/knowledge"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
)

// Writing articles: 60 per 10 minutes per person.
var knowledgeWrites = ratelimit.Rule{MaxAttempts: 60, Window: 10 * time.Minute}

func (s *Server) registerKnowledge(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/knowledge", s.withSession(s.knowledgeList))
	routes.HandleFunc("GET /api/v1/knowledge/articles/{id}", s.withSession(s.knowledgeArticle))
	routes.HandleFunc("POST /api/v1/knowledge/articles", s.withSession(s.writeArticle))
	routes.HandleFunc("POST /api/v1/knowledge/articles/{id}/edit", s.withSession(s.editArticle))
	routes.HandleFunc("POST /api/v1/knowledge/articles/{id}/status", s.withSession(s.changeArticleStatus))
	routes.HandleFunc("POST /api/v1/knowledge/articles/{id}/delete", s.withSession(s.deleteArticle))
	routes.HandleFunc("POST /api/v1/knowledge/test", s.withSession(s.testKnowledge))
	routes.HandleFunc("POST /api/v1/knowledge/import/document", s.withSession(s.importDocument))
	routes.HandleFunc("POST /api/v1/knowledge/import/web", s.withSession(s.importWebPage))
}

// knowledgeList: GET ?status= (all, draft, approved, archived) &q= (titles) &page=.
func (s *Server) knowledgeList(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	status := r.URL.Query().Get("status")
	if !knowledge.IsStatusFilter(status) {
		status = "all"
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if utf8.RuneCountInString(q) > 200 {
		q = string([]rune(q)[:200])
	}
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	page = min(max(page, 1), 10_000)
	articles, err := knowledge.List(r.Context(), s.Pool, who.CompanyID, status, q, page)
	if err != nil {
		s.failed(w, "knowledge list", err)
		return
	}
	counts, err := knowledge.Counts(r.Context(), s.Pool, who.CompanyID, q)
	if err != nil {
		s.failed(w, "knowledge list", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"articles": articles, "counts": counts, "status": status, "q": q, "page": page, "canManage": who.IsOwner()})
}

// knowledgeArticle: one article, and what this person may do with it.
func (s *Server) knowledgeArticle(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	id := strings.ToLower(r.PathValue("id"))
	if !uuidPattern.MatchString(id) {
		problem(w, http.StatusNotFound, "Article not found.")
		return
	}
	article, err := knowledge.Read(r.Context(), s.Pool, who.CompanyID, id)
	switch {
	case err != nil:
		s.failed(w, "knowledge article", err)
	case article == nil:
		problem(w, http.StatusNotFound, "Article not found.")
	default:
		writeJSON(w, http.StatusOK, map[string]any{"article": article, "canEdit": knowledge.CanEdit(who.Role, article.Status), "canManage": who.IsOwner()})
	}
}

// articleInput is what the article forms send.
type articleInput struct {
	Title           string `json:"title"`
	Body            string `json:"body"`
	Kind            string `json:"kind"`
	UseForSupport   bool   `json:"useForSupport"`
	UseForMarketing bool   `json:"useForMarketing"`
	// New articles only: a solved request's number ("Save as knowledge").
	FromTicket int `json:"fromTicket,omitempty"`
	// Edits only: the revision the page showed.
	Revision int `json:"revision,omitempty"`
}

// fields checks an article's fields: the title one plain line of 1-200;
// the body 1-20,000 characters (a line break counts once and is stored as
// \n), no control characters but line breaks and tabs; a known kind.
func (in articleInput) fields() (knowledge.Fields, map[string]string) {
	problems := map[string]string{}
	title := plaintext.SingleLine(in.Title)
	switch {
	case title == "":
		problems["title"] = "Give the article a title."
	case utf8.RuneCountInString(title) > 200:
		problems["title"] = "A title can be at most 200 characters."
	}
	body := strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(in.Body, "\r\n", "\n"), "\r", "\n"))
	switch {
	case body == "":
		problems["body"] = "Write the article first."
	case utf8.RuneCountInString(body) > 20_000:
		problems["body"] = "An article can be at most 20,000 characters."
	case strings.ContainsFunc(body, func(r rune) bool { return unicode.IsControl(r) && r != '\n' && r != '\t' }):
		problems["body"] = "Remove the invisible control characters from the text."
	}
	if !knowledge.Kinds[in.Kind] {
		problems["kind"] = "Pick what kind of article this is."
	}
	return knowledge.Fields{Title: title, Body: body, Kind: in.Kind, UseForSupport: in.UseForSupport, UseForMarketing: in.UseForMarketing}, problems
}

// readArticle reads and checks an article form, counting the person's write.
func (s *Server) readArticle(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) (articleInput, knowledge.Fields, bool) {
	var input articleInput
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return input, knowledge.Fields{}, false
	}
	fields, problems := input.fields()
	if len(problems) > 0 {
		fieldProblems(w, problems)
		return input, fields, false
	}
	if over, err := s.Limiter.Over(r.Context(), "knowledge-writes", who.UserID, knowledgeWrites); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Too many changes. Try again in a few minutes.")
		return input, fields, false
	}
	return input, fields, true
}

// writeArticle: a new draft (anyone in the company).
func (s *Server) writeArticle(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	input, fields, ok := s.readArticle(w, r, body, who)
	if !ok {
		return
	}
	ids, outcome, err := knowledge.CreateDrafts(r.Context(), s.Pool, who.CompanyID, who.UserID, []knowledge.Fields{fields}, knowledge.Source{TicketNumber: input.FromTicket})
	switch {
	case err != nil:
		s.failed(w, "knowledge write", err)
	case outcome == "full":
		problem(w, http.StatusConflict, "Your company has 1,000 articles, the most there can be. Delete some first.")
	case outcome != "created":
		problem(w, http.StatusForbidden, "You can't write articles here.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"id": ids[0]})
	}
}

// editArticle: {revision, ...} the article as the page showed it.
func (s *Server) editArticle(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	input, fields, ok := s.readArticle(w, r, body, who)
	if !ok {
		return
	}
	outcome, err := knowledge.Edit(r.Context(), s.Pool, who.CompanyID, who.UserID, strings.ToLower(r.PathValue("id")), input.Revision, fields)
	s.articleOutcome(w, outcome, err)
}

// articleOutcome answers a change of an article.
func (s *Server) articleOutcome(w http.ResponseWriter, outcome string, err error) {
	switch {
	case err != nil:
		s.failed(w, "knowledge change", err)
	case outcome == "not-found":
		problem(w, http.StatusNotFound, "Article not found.")
	case outcome == "not-allowed":
		problem(w, http.StatusForbidden, "Only owners can change an approved article, approve, archive, restore or delete.")
	case outcome == "stale":
		problem(w, http.StatusConflict, "Someone changed this article after you opened it. Reload to see their version.")
	case outcome == "wrong-status":
		problem(w, http.StatusConflict, "Another owner changed this article's status meanwhile. Reload to see it.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": outcome})
	}
}

// changeArticleStatus: {change: approve | archive | restore, revision}.
func (s *Server) changeArticleStatus(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		Change   string `json:"change"`
		Revision int    `json:"revision"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "knowledge-writes", who.UserID, knowledgeWrites); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Too many changes. Try again in a few minutes.")
		return
	}
	outcome, err := knowledge.ChangeStatus(r.Context(), s.Pool, who.CompanyID, who.UserID, strings.ToLower(r.PathValue("id")), input.Change, input.Revision)
	s.articleOutcome(w, outcome, err)
}

// deleteArticle: for good (owners; archive keeps it instead).
func (s *Server) deleteArticle(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	if over, err := s.Limiter.Over(r.Context(), "knowledge-writes", who.UserID, knowledgeWrites); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Too many changes. Try again in a few minutes.")
		return
	}
	outcome, err := knowledge.Delete(r.Context(), s.Pool, who.CompanyID, who.UserID, strings.ToLower(r.PathValue("id")))
	s.articleOutcome(w, outcome, err)
}
