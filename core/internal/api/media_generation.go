package api

import (
	"net/http"
	"strings"

	"ansa/core/internal/media"
	"ansa/core/internal/mediagen"
	"ansa/core/internal/session"
	"ansa/core/internal/studio"
)

// Asking for images and videos, and a draft's media: attaching one from
// the library (or taking it off) and "Make the image with the AI". A
// request is saved, then run right after the answer.

func (s *Server) registerGenerations(routes *http.ServeMux) {
	routes.HandleFunc("POST /api/v1/media/generations", s.withSession(s.requestGeneration))
	routes.HandleFunc("POST /api/v1/media/generations/{id}/cancel", s.withSession(s.withMediaChange(s.cancelGeneration)))
	routes.HandleFunc("POST /api/v1/media/generations/{id}/start", s.withSession(s.withMediaChange(s.startGeneration)))
	routes.HandleFunc("POST /api/v1/cofounder/drafts/{id}/media", s.withSession(s.withDraftChange(s.setDraftMedia)))
	routes.HandleFunc("POST /api/v1/cofounder/drafts/{id}/image", s.withSession(s.requestDraftImage))
}

// requestGeneration: {kind: "image" | "video", prompt}: answers {jobId}.
func (s *Server) requestGeneration(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		Kind   string `json:"kind"`
		Prompt string `json:"prompt"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	prompt, problems := mediagen.CheckRequest(input.Kind, input.Prompt)
	if len(problems) > 0 {
		fieldProblems(w, problems)
		return
	}
	jobID, refusal, err := s.Studio.Generation.Request(r.Context(), who.CompanyID, who.UserID, input.Kind, prompt)
	s.answerRequest(w, who, jobID, refusal, err)
}

// requestDraftImage: {version}: from the draft's SAVED image description,
// attached once made while the draft is still at that version.
func (s *Server) requestDraftImage(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	id := strings.ToLower(r.PathValue("id"))
	var input struct {
		Version int `json:"version"`
	}
	if !uuidPattern.MatchString(id) || !readJSON(body, &input) || input.Version < 1 {
		problem(w, http.StatusBadRequest, "Unknown draft. Reload the page and try again.")
		return
	}
	jobID, refusal, err := s.Studio.Generation.RequestForDraft(r.Context(), who.CompanyID, who.UserID, id, input.Version)
	s.answerRequest(w, who, jobID, refusal, err)
}

// answerRequest answers a saved request (and runs it after the answer), or why not.
func (s *Server) answerRequest(w http.ResponseWriter, who *session.Session, jobID, refusal string, err error) {
	switch {
	case err != nil:
		s.failed(w, "generation request", err)
	case refusal != "":
		problem(w, http.StatusConflict, refusal)
	default:
		s.Studio.Generation.RunInBackground(who.CompanyID, jobID, nil)
		writeJSON(w, http.StatusOK, map[string]string{"jobId": jobID})
	}
}

// setDraftMedia: {version, assetId} ("" takes it off): a change of
// content, the next version without any approval.
func (s *Server) setDraftMedia(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session, draftID string) {
	var input struct {
		Version int    `json:"version"`
		AssetID string `json:"assetId"`
	}
	if !readJSON(body, &input) || input.Version < 1 || (input.AssetID != "" && !uuidPattern.MatchString(input.AssetID)) {
		problem(w, http.StatusBadRequest, "Unknown draft or image. Reload the page and try again.")
		return
	}
	var assetID *string
	if input.AssetID != "" {
		lowered := strings.ToLower(input.AssetID)
		assetID = &lowered
	}
	outcome, err := media.SetDraftMedia(r.Context(), s.Pool, who.CompanyID, who.UserID, draftID, input.Version, assetID)
	switch {
	case outcome == media.WrongKind:
		problem(w, http.StatusConflict, "A post with an image takes an image, and a video a video; a text post takes neither.")
	case outcome == media.MediaNotFound:
		problem(w, http.StatusNotFound, "We couldn't find that image or video: it may have been deleted. Reload the page.")
	default:
		s.answerDraftChange(w, "draft media", outcome, err)
	}
}

// draftMediaPanel is the media panel of a draft's page.
func (s *Server) draftMediaPanel(r *http.Request, who *session.Session, page *studio.Page) (any, error) {
	return s.Studio.Generation.DraftPanel(r.Context(), who.CompanyID, page.ID, page.Format, page.Version, page.MediaAssetID)
}
