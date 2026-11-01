package api

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"ansa/core/internal/contentrules"
	"ansa/core/internal/drafts"
	"ansa/core/internal/mediagen"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
	"ansa/core/internal/studio"
)

// The Co-Founder's content studio: the list, a draft's page, new drafts
// (blank or written by the AI), edits, Regenerate, Approve, Reject,
// Archive and Restore. Everyone in the company writes; owners approve and
// reject (checked here for a clear message, and again inside the write).

// content-draft-changes: 120 per 10 minutes per person (the old counter).
var draftChanges = ratelimit.Rule{MaxAttempts: 120, Window: 10 * time.Minute}

// The page's words for each outcome of a change.
var draftRefusals = map[string]struct {
	status  int
	message string
}{
	studio.NotFound:    {http.StatusNotFound, "We couldn't find that draft. Reload the page."},
	studio.NotAllowed:  {http.StatusForbidden, "You can't change drafts of this company."},
	studio.Stale:       {http.StatusConflict, "Someone changed this draft after you opened it, so nothing was saved. Copy what you typed, reload the page and make your change again."},
	studio.WrongStatus: {http.StatusConflict, "This draft's status changed meanwhile (an archived draft must be restored first). Reload the page to see it."},
}

const onlyOwnersDecide = "Only owners can approve or reject drafts."

// StudioServices are the content studio's and the media library's parts.
type StudioServices struct {
	// The AI's drafts (the brain with room for its 2 tries of 120 s).
	Writer *studio.Writer
	// Images and videos asked of an image service (MEDIA_PROVIDER).
	Generation *mediagen.Service
}

func (s *Server) registerStudio(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/cofounder/drafts", s.withSession(s.listDrafts))
	routes.HandleFunc("GET /api/v1/cofounder/drafts/new", s.withSession(s.newDraftOptions))
	routes.HandleFunc("POST /api/v1/cofounder/drafts", s.withSession(s.createDraft))
	routes.HandleFunc("GET /api/v1/cofounder/drafts/{id}", s.withSession(s.draftPage))
	routes.HandleFunc("POST /api/v1/cofounder/drafts/{id}/edit", s.withSession(s.withDraftChange(s.editDraft)))
	routes.HandleFunc("POST /api/v1/cofounder/drafts/{id}/regenerate", s.withSession(s.regenerateDraft))
	routes.HandleFunc("POST /api/v1/cofounder/drafts/{id}/approve", s.withSession(s.ownersDecide(s.approveDraft)))
	routes.HandleFunc("POST /api/v1/cofounder/drafts/{id}/reject", s.withSession(s.ownersDecide(s.rejectDraft)))
	routes.HandleFunc("POST /api/v1/cofounder/drafts/{id}/archive", s.withSession(s.withDraftChange(s.archiveDraft)))
	routes.HandleFunc("POST /api/v1/cofounder/drafts/{id}/restore", s.withSession(s.withDraftChange(s.restoreDraft)))
	s.registerMedia(routes)
}

// listDrafts: GET ?status=current|idea|...|archived&platform=all|<platform>&page=n
// (odd values fall back to the defaults): {drafts, counts, status, platform, page}.
func (s *Server) listDrafts(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	query := r.URL.Query()
	status := query.Get("status")
	if !drafts.In(drafts.ListFilters, status) {
		status = "current"
	}
	platform := query.Get("platform")
	if !contentrules.Takes(contentrules.Platforms, platform) {
		platform = "all"
	}
	page, err := strconv.Atoi(query.Get("page"))
	if err != nil || page < 1 || page > 10_000 {
		page = 1
	}
	list, err := drafts.List(r.Context(), s.Pool, who.CompanyID, status, platform, page)
	if err != nil {
		s.failed(w, "drafts list", err)
		return
	}
	counts, err := drafts.CountPerStatus(r.Context(), s.Pool, who.CompanyID, platform)
	if err != nil {
		s.failed(w, "drafts counts", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"drafts": list, "counts": counts, "status": status, "platform": platform, "page": page, "pageSize": drafts.PageSize})
}

// newDraftOptions: GET {missingForAi, planChoices}.
func (s *Server) newDraftOptions(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	options, err := studio.ReadNewDraftOptions(r.Context(), s.Pool, who.CompanyID)
	if err != nil {
		s.failed(w, "new draft options", err)
		return
	}
	writeJSON(w, http.StatusOK, options)
}

// createDraft: {platform, format, topic, pillar, campaign, withAi}: a blank
// draft (an idea), or one the AI writes (waits for it). Answers {draftId}.
func (s *Server) createDraft(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		studio.NewDraftForm
		WithAI bool `json:"withAi"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	checked, problems := studio.CheckNewDraft(input.NewDraftForm)
	if len(problems) > 0 {
		fieldProblems(w, problems)
		return
	}
	if input.WithAI {
		allowLongAnswer(w, 290*time.Second)
		result, err := s.Studio.Writer.Generate(r.Context(), who.CompanyID, who.UserID, checked)
		s.answerGeneration(w, result, err)
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "content-draft-changes", who.UserID, draftChanges); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Too many changes. Try again in a few minutes.")
		return
	}
	id, outcome, err := studio.Create(r.Context(), s.Pool, who.CompanyID, who.UserID, checked, nil)
	switch {
	case err != nil:
		s.failed(w, "draft create", err)
	case outcome != "created":
		problem(w, http.StatusForbidden, "You can't add drafts to this company.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"draftId": id})
	}
}

// draftPage: GET a draft's page (404: unknown, or another company's).
func (s *Server) draftPage(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	id := strings.ToLower(r.PathValue("id"))
	if !uuidPattern.MatchString(id) {
		problem(w, http.StatusNotFound, "Unknown draft.")
		return
	}
	page, err := studio.ReadPage(r.Context(), s.Pool, who.CompanyID, id)
	if err == nil && page != nil {
		page.Media, err = s.draftMediaPanel(r, who, page)
	}
	switch {
	case err != nil:
		s.failed(w, "draft page", err)
	case page == nil:
		problem(w, http.StatusNotFound, "Unknown draft.")
	default:
		writeJSON(w, http.StatusOK, map[string]any{"draft": page, "canReview": who.IsOwner()})
	}
}

// draftChange is a change of one draft: its id (checked) and the body.
type draftChange func(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session, draftID string)

// withDraftChange checks the id and the content-draft-changes limit.
func (s *Server) withDraftChange(h draftChange) handler {
	return func(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
		id := strings.ToLower(r.PathValue("id"))
		if !uuidPattern.MatchString(id) {
			problem(w, http.StatusBadRequest, "Unknown draft. Reload the page and try again.")
			return
		}
		if over, err := s.Limiter.Over(r.Context(), "content-draft-changes", who.UserID, draftChanges); err != nil || over {
			problem(w, http.StatusTooManyRequests, "Too many changes. Try again in a few minutes.")
			return
		}
		h(w, r, body, who, id)
	}
}

// ownersDecide: owners only (a clear message first), then withDraftChange.
func (s *Server) ownersDecide(h draftChange) handler {
	return func(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
		if !who.IsOwner() {
			problem(w, http.StatusForbidden, onlyOwnersDecide)
			return
		}
		s.withDraftChange(h)(w, r, body, who)
	}
}

// answerDraftChange answers a change's outcome.
func (s *Server) answerDraftChange(w http.ResponseWriter, what, outcome string, err error) {
	if err != nil {
		s.failed(w, what, err)
		return
	}
	if refusal, refused := draftRefusals[outcome]; refused {
		problem(w, refusal.status, refusal.message)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"outcome": outcome})
}
