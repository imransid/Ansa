package api

import (
	"encoding/base64"
	"errors"
	"net/http"
	"strings"

	"ansa/core/internal/documents"
	"ansa/core/internal/logging"
	"ansa/core/internal/session"
)

// The company's documents (registered in support.go).

// uploadDocument: {fileName, data: base64} (owners).
func (s *Server) uploadDocument(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	if !who.IsOwner() {
		problem(w, http.StatusForbidden, "Only owners can upload documents.")
		return
	}
	var input struct {
		FileName string `json:"fileName"`
		Data     string `json:"data"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, documents.Empty)
		return
	}
	data, err := base64.StdEncoding.DecodeString(input.Data)
	if err != nil {
		problem(w, http.StatusBadRequest, documents.Empty)
		return
	}
	if _, _, why := documents.Check(input.FileName, len(data)); why != "" {
		problem(w, http.StatusBadRequest, why)
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "document-uploads", who.UserID, documentUploads); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Too many uploads. Try again in a few minutes.")
		return
	}
	err = documents.Upload(r.Context(), s.Pool, s.Files, who.CompanyID, who.UserID, input.FileName, data)
	switch {
	case errors.Is(err, documents.ErrFull):
		problem(w, http.StatusConflict, documents.Full)
	case err != nil:
		// Storage down or misconfigured: a message, never an error screen.
		s.Log.Error("api: document upload failed", logging.ErrorType(err))
		problem(w, http.StatusServiceUnavailable, "The file could not be stored right now, so nothing was saved. Try again in a few minutes.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": "uploaded"})
	}
}

// downloadDocument: {"url"} (a 5-minute signed link, "save as") or, in
// development, {"fileName", "contentType", "data": base64} for the screens
// to serve. Too many downloads answer 429, never 404.
func (s *Server) downloadDocument(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	id := strings.ToLower(r.PathValue("id"))
	if !uuidPattern.MatchString(id) {
		problem(w, http.StatusNotFound, "Document not found.")
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "document-downloads", who.UserID, documentDownloads); err != nil || over {
		problem(w, http.StatusTooManyRequests, "Too many downloads. Try again in a few minutes.")
		return
	}
	document, err := documents.Find(r.Context(), s.Pool, who.CompanyID, id)
	if err != nil || document == nil {
		if err != nil {
			s.failed(w, "document", err)
			return
		}
		problem(w, http.StatusNotFound, "Document not found.")
		return
	}
	access, found, err := s.Files.Reach(r.Context(), document.StorageKey, document.ContentType, documents.LinkSeconds, document.FileName)
	switch {
	case err != nil:
		s.failed(w, "document", err)
	case !found:
		problem(w, http.StatusNotFound, "Document not found.")
	case access.SignedURL != "":
		writeJSON(w, http.StatusOK, map[string]string{"url": access.SignedURL})
	default:
		writeJSON(w, http.StatusOK, map[string]string{"fileName": document.FileName, "contentType": document.ContentType, "data": base64.StdEncoding.EncodeToString(access.Bytes)})
	}
}

// deleteDocument: the file first, then the row (owners).
func (s *Server) deleteDocument(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	id := strings.ToLower(r.PathValue("id"))
	if !uuidPattern.MatchString(id) {
		problem(w, http.StatusNotFound, "Document not found.")
		return
	}
	deleted, err := documents.Delete(r.Context(), s.Pool, s.Files, who.CompanyID, id)
	switch {
	case err != nil:
		s.Log.Error("api: document delete failed", logging.ErrorType(err))
		problem(w, http.StatusServiceUnavailable, "The file could not be deleted right now, so the document is still here. Try again in a few minutes.")
	case !deleted:
		problem(w, http.StatusNotFound, "Document not found.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": "deleted"})
	}
}
