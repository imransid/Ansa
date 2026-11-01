package api

import (
	"encoding/base64"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"ansa/core/internal/logging"
	"ansa/core/internal/media"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
)

// The Co-Founder's media library: the list, uploads, a file for the
// screens to show, alt text and deleting. Everyone in the company.

var (
	mediaUploads = ratelimit.Rule{MaxAttempts: 30, Window: 10 * time.Minute}
	mediaViews   = ratelimit.Rule{MaxAttempts: 1_000, Window: 10 * time.Minute}
	mediaChanges = ratelimit.Rule{MaxAttempts: 120, Window: 10 * time.Minute}
)

const tooManyMediaChanges = "Too many changes. Try again in a few minutes."

func (s *Server) registerMedia(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/media", s.withSession(s.mediaPage))
	routes.HandleFunc("POST /api/v1/media", s.withSessionUpTo(menuReadBodyBytes, s.uploadMedia))
	routes.HandleFunc("GET /api/v1/media/{id}/file", s.withSession(s.mediaFile))
	routes.HandleFunc("POST /api/v1/media/{id}/alt-text", s.withSession(s.withMediaChange(s.saveAltText)))
	routes.HandleFunc("POST /api/v1/media/{id}/delete", s.withSession(s.withMediaChange(s.deleteMedia)))
	s.registerGenerations(routes)
}

// mediaPage: GET ?page=n: {assets (each with the drafts using it), totals
// {count, totalBytes}, jobs (the newest requests), generation, page, pageSize}.
func (s *Server) mediaPage(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	page, err := strconv.Atoi(r.URL.Query().Get("page"))
	if err != nil || page < 1 || page > 10_000 {
		page = 1
	}
	assets, err := media.List(r.Context(), s.Pool, who.CompanyID, page)
	if err != nil {
		s.failed(w, "media list", err)
		return
	}
	count, total, err := media.Totals(r.Context(), s.Pool, who.CompanyID)
	if err != nil {
		s.failed(w, "media totals", err)
		return
	}
	jobs, err := s.Studio.Generation.Jobs(r.Context(), who.CompanyID)
	if err != nil {
		s.failed(w, "media jobs", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"assets": assets, "totals": map[string]int{"count": count, "totalBytes": total},
		"jobs": jobs, "generation": s.Studio.Generation.Mode.Availability(), "page": page, "pageSize": media.PageSize})
}

// uploadMedia: {fileName, data: base64, altText}: the name's type AND the
// file's own first bytes must agree; at most 4 MB. Answers {assetId}.
func (s *Server) uploadMedia(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		FileName string `json:"fileName"`
		Data     string `json:"data"`
		AltText  string `json:"altText"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, media.EmptyFile)
		return
	}
	altText, altProblem := media.CheckAltText(input.AltText)
	if altProblem != "" {
		fieldProblems(w, map[string]string{"altText": altProblem})
		return
	}
	data, err := base64.StdEncoding.DecodeString(input.Data)
	if err != nil {
		problem(w, http.StatusBadRequest, media.EmptyFile)
		return
	}
	if _, why := media.CheckFile(input.FileName, data); why != "" {
		problem(w, http.StatusBadRequest, why)
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "media-uploads", who.UserID, mediaUploads); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Too many uploads. Try again in a few minutes.")
		return
	}
	assetID, err := media.Upload(r.Context(), s.Pool, s.Files, who.CompanyID, who.UserID, input.FileName, data, altText)
	switch {
	case errors.Is(err, media.ErrFull):
		problem(w, http.StatusConflict, media.LibraryFull)
	case errors.Is(err, media.ErrNotAllowed):
		problem(w, http.StatusForbidden, "You can't add media to this company.")
	case err != nil:
		// Storage down: a message, never an error screen (logged by class only).
		s.Log.Error("api: media upload failed", logging.ErrorType(err))
		problem(w, http.StatusServiceUnavailable, "The file could not be stored right now, so nothing was saved. Try again in a few minutes.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"assetId": assetID})
	}
}

// mediaFile: GET {"url"} (a 5-minute signed link) or, in development,
// {"contentType", "data": base64} for the screens to serve inline with the
// type stored, nosniff and a sandbox. Too many answer 429, never 404.
func (s *Server) mediaFile(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	id := strings.ToLower(r.PathValue("id"))
	if !uuidPattern.MatchString(id) {
		problem(w, http.StatusNotFound, "Image not found.")
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "media-views", who.UserID, mediaViews); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Too many images opened. Try again in a few minutes.")
		return
	}
	asset, key, err := media.Find(r.Context(), s.Pool, who.CompanyID, id)
	if err != nil || asset == nil {
		s.answerMissingFile(w, err)
		return
	}
	access, found, err := s.Files.Reach(r.Context(), key, asset.ContentType, media.LinkSeconds, "")
	switch {
	case err != nil || !found:
		s.answerMissingFile(w, err)
	case access.SignedURL != "":
		writeJSON(w, http.StatusOK, map[string]string{"url": access.SignedURL})
	default:
		writeJSON(w, http.StatusOK, map[string]string{"contentType": asset.ContentType, "data": base64.StdEncoding.EncodeToString(access.Bytes)})
	}
}

func (s *Server) answerMissingFile(w http.ResponseWriter, err error) {
	if err != nil {
		s.failed(w, "media file", err)
		return
	}
	problem(w, http.StatusNotFound, "Image not found.")
}
