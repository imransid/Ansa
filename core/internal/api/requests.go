package api

import (
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"ansa/core/internal/conversations"
	"ansa/core/internal/inbound"
	"ansa/core/internal/inbox"
	"ansa/core/internal/knowledge"
	"ansa/core/internal/outbox"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
	"ansa/core/internal/tickets"
)

// A person's request changes: 120 per 10 minutes (the old counter).
var ticketChanges = ratelimit.Rule{MaxAttempts: 120, Window: 10 * time.Minute}

// A person's id as Better Auth makes it: never trusted, only matched.
var userIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

const requestGone = "This request isn't there any more. Reload the page."

func (s *Server) registerRequests(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/requests", s.withSession(s.listRequests))
	routes.HandleFunc("GET /api/v1/requests/{number}", s.withSession(s.requestPage))
	routes.HandleFunc("POST /api/v1/requests/{id}/assign", s.withSession(s.requestChange(s.assignRequest)))
	routes.HandleFunc("POST /api/v1/requests/{id}/category", s.withSession(s.requestChange(s.setRequestCategory)))
	routes.HandleFunc("POST /api/v1/requests/{id}/notes", s.withSession(s.requestChange(s.addRequestNote)))
	routes.HandleFunc("POST /api/v1/requests/{id}/close", s.withSession(s.requestChange(s.closeRequest)))
	routes.HandleFunc("POST /api/v1/requests/{id}/reopen", s.withSession(s.requestChange(s.reopenRequest)))
	routes.HandleFunc("POST /api/v1/conversations/{id}/done", s.withSession(s.requestChange(s.finishChatRequest)))
}

// listRequests: GET /api/v1/requests?view=&q=&page= (members land on
// "mine", owners on "open"; "mine" is always the session's own person).
func (s *Server) listRequests(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	query := r.URL.Query()
	view := query.Get("view")
	if !tickets.IsView(view) {
		view = map[bool]string{true: "open", false: "mine"}[who.IsOwner()]
	}
	q := query.Get("q")
	if len(q) > 200 {
		q = q[:200]
	}
	page, _ := strconv.Atoi(query.Get("page"))
	lines, err := tickets.List(r.Context(), s.Pool, who.CompanyID, who.UserID, view, q, page)
	if err != nil {
		s.failed(w, "requests", err)
		return
	}
	counts, err := tickets.CountPerView(r.Context(), s.Pool, who.CompanyID, who.UserID, q)
	if err != nil {
		s.failed(w, "request counts", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"view": view, "lines": lines, "counts": counts})
}

// requestPage: GET /api/v1/requests/{number}, with who it can be given to
// and the categories.
func (s *Server) requestPage(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	number, err := strconv.Atoi(r.PathValue("number"))
	if err != nil || number < 1 {
		problem(w, http.StatusNotFound, requestGone)
		return
	}
	detail, err := tickets.ReadDetail(r.Context(), s.Pool, s.Box, who.CompanyID, number)
	if errors.Is(err, tickets.ErrNoTicket) {
		problem(w, http.StatusNotFound, requestGone)
		return
	}
	if err != nil {
		s.failed(w, "request", err)
		return
	}
	people, err := tickets.AssigneeChoices(r.Context(), s.Pool, who.CompanyID)
	if err != nil {
		s.failed(w, "request people", err)
		return
	}
	categories, err := tickets.ActiveCategories(r.Context(), s.Pool, who.CompanyID)
	if err != nil {
		s.failed(w, "request categories", err)
		return
	}
	latest, err := outbox.ReadLatest(r.Context(), s.Pool, who.CompanyID, detail.ID)
	if err != nil {
		s.failed(w, "request email", err)
		return
	}
	page := map[string]any{"request": detail, "people": people, "categories": categories, "canReopen": who.IsOwner(), "latestEmail": latest}
	if err := s.addRequestContext(r, who, detail, page); err != nil {
		s.failed(w, "request context", err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// addRequestContext adds the email the request came from, the same
// customer's other open requests, and up to 3 approved support articles
// matching its subject and category (one piece each, best first).
func (s *Server) addRequestContext(r *http.Request, who *session.Session, detail *tickets.Detail, page map[string]any) error {
	ctx := r.Context()
	var err error
	if page["originalEmail"], err = inbound.ReadOriginal(ctx, s.Pool, s.Box, who.CompanyID, detail.ID); err != nil {
		return err
	}
	if page["sameCustomer"], err = tickets.OtherOpenFromSameCustomer(ctx, s.Pool, who.CompanyID, detail.ID); err != nil {
		return err
	}
	query := detail.Subject
	if detail.Category != nil {
		query += " " + *detail.Category
	}
	hits, err := knowledge.Search(ctx, s.Pool, who.CompanyID, query, "support", 10)
	if err != nil {
		return err
	}
	related := []knowledge.Hit{}
	seen := map[string]bool{}
	for _, hit := range hits {
		if !seen[hit.ArticleID] && len(related) < 3 {
			seen[hit.ArticleID] = true
			related = append(related, hit)
		}
	}
	page["relatedKnowledge"] = related
	return nil
}

// requestAction is one change of a request: ok, or the words saying why not.
type requestAction func(r *http.Request, body []byte, who *session.Session, id string) (string, error)

// requestChange checks the id and the person's limit, runs the change and
// answers {} or {"error"}.
func (s *Server) requestChange(action requestAction) handler {
	return func(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
		id := strings.ToLower(r.PathValue("id"))
		if !uuidPattern.MatchString(id) {
			problem(w, http.StatusNotFound, requestGone)
			return
		}
		if over, err := s.Limiter.Over(r.Context(), "ticket-changes", who.UserID, ticketChanges); err != nil || over {
			problem(w, http.StatusTooManyRequests, "Too many changes. Try again in a few minutes.")
			return
		}
		refusal, err := action(r, orEmpty(body), who, id)
		switch {
		case err != nil:
			s.failed(w, "request change", err)
		case refusal != "":
			problem(w, http.StatusConflict, refusal)
		default:
			writeJSON(w, http.StatusOK, map[string]string{})
		}
	}
}

func (s *Server) assignRequest(r *http.Request, body []byte, who *session.Session, id string) (string, error) {
	var input struct {
		AssigneeID string `json:"assigneeId"`
	}
	if !readJSON(body, &input) || (input.AssigneeID != "" && !userIDPattern.MatchString(input.AssigneeID)) {
		return requestGone, nil
	}
	outcome, err := tickets.Assign(r.Context(), s.Pool, who.CompanyID, who.UserID, id, input.AssigneeID)
	if outcome == tickets.Refused {
		return "This person can't take requests, or the request is gone. Reload the page.", err
	}
	return "", err
}

func (s *Server) setRequestCategory(r *http.Request, body []byte, who *session.Session, id string) (string, error) {
	var input struct {
		Category string `json:"category"`
	}
	if !readJSON(body, &input) || len(input.Category) > 200 {
		return requestGone, nil
	}
	outcome, err := tickets.SetCategory(r.Context(), s.Pool, who.CompanyID, who.UserID, id, input.Category)
	if outcome == tickets.Refused {
		return "This category isn't there any more. Reload the page.", err
	}
	return "", err
}

func (s *Server) addRequestNote(r *http.Request, body []byte, who *session.Session, id string) (string, error) {
	var input struct {
		Text string `json:"text"`
	}
	if !readJSON(body, &input) {
		return requestGone, nil
	}
	text, problemText := plaintext.Note(input.Text, 5000)
	if problemText == "" && text == "" {
		problemText = "Write a note first."
	}
	if problemText != "" {
		return problemText, nil
	}
	noteID, err := conversations.NewID()
	if err != nil {
		return "", err
	}
	encrypted, err := s.Box.Encrypt(text, tickets.NoteContext(who.CompanyID, id, noteID))
	if err != nil {
		return "", err
	}
	added, err := tickets.AddNote(r.Context(), s.Pool, who.CompanyID, who.UserID, id, noteID, encrypted)
	if !added && err == nil {
		return requestGone, nil
	}
	return "", err
}

func (s *Server) closeRequest(r *http.Request, _ []byte, who *session.Session, id string) (string, error) {
	closed, err := tickets.CloseWithoutEmail(r.Context(), s.Pool, who.CompanyID, who.UserID, id)
	if !closed && err == nil {
		return "This request is already closed, or gone. Reload the page.", nil
	}
	return "", err
}

func (s *Server) reopenRequest(r *http.Request, _ []byte, who *session.Session, id string) (string, error) {
	if !who.IsOwner() {
		return "Only owners can reopen a request.", nil
	}
	outcome, err := tickets.Reopen(r.Context(), s.Pool, who.CompanyID, who.UserID, id)
	switch outcome {
	case tickets.NotAllowed:
		return "Only owners can reopen a request.", err
	case tickets.Refused:
		return "This request is already open, or gone. Reload the page.", err
	}
	return "", err
}

// finishChatRequest: "Done" on a chat's request: closed without an email
// (a chat has none to send), then the conversation goes back to ansa. Two
// steps, each its own transaction: a refused hand back leaves the request
// closed, and the page then offers "Hand back to ansa".
func (s *Server) finishChatRequest(r *http.Request, body []byte, who *session.Session, conversationID string) (string, error) {
	var input struct {
		TicketID string `json:"ticketId"`
	}
	if !readJSON(body, &input) || !uuidPattern.MatchString(strings.ToLower(input.TicketID)) {
		return requestGone, nil
	}
	if refusal, err := s.closeRequest(r, nil, who, strings.ToLower(input.TicketID)); refusal != "" || err != nil {
		return refusal, err
	}
	outcome, err := inbox.HandBack(r.Context(), s.Pool, who.CompanyID, who.UserID, conversationID)
	if outcome != inbox.Saved && outcome != inbox.Unchanged && err == nil {
		return inboxRefusals[outcome], nil
	}
	return "", err
}
