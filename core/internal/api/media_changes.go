package api

import (
	"net/http"
	"strings"

	"ansa/core/internal/logging"
	"ansa/core/internal/media"
	"ansa/core/internal/mediagen"
	"ansa/core/internal/session"
)

// Changes of the media library (registered in media.go): alt text,
// deleting, and the requests' Cancel and "Start now", each within the
// person's media-changes limit.

// mediaChange is a change of one asset or request: its id (checked) and the body.
type mediaChange func(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session, id string)

// withMediaChange checks the id and the media-changes limit.
func (s *Server) withMediaChange(h mediaChange) handler {
	return func(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
		id := strings.ToLower(r.PathValue("id"))
		if !uuidPattern.MatchString(id) {
			problem(w, http.StatusBadRequest, "Unknown image. Reload the page.")
			return
		}
		if over, err := s.Limiter.Over(r.Context(), "media-changes", who.UserID, mediaChanges); err != nil || over {
			problem(w, http.StatusTooManyRequests, tooManyMediaChanges)
			return
		}
		h(w, r, body, who, id)
	}
}

// saveAltText: {altText}: one plain line of at most 1,000 characters. The
// drafts using the image get it as their next version (an approved one
// loses its approval); refused while one is scheduled, published or failed.
func (s *Server) saveAltText(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session, assetID string) {
	var input struct {
		AltText string `json:"altText"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Unknown image. Reload the page.")
		return
	}
	altText, altProblem := media.CheckAltText(input.AltText)
	if altProblem != "" {
		fieldProblems(w, map[string]string{"altText": altProblem})
		return
	}
	change, err := media.UpdateAltText(r.Context(), s.Pool, who.CompanyID, who.UserID, assetID, altText)
	switch {
	case err != nil:
		s.failed(w, "media alt text", err)
	case change.Outcome == media.InUse:
		problem(w, http.StatusConflict, "It can't be changed while "+media.DraftsUsingWords(change.Drafts)+
			" it: a draft that is scheduled, published or failed to publish keeps the alt text it was approved with.")
	case change.Outcome == media.NotFound:
		problem(w, http.StatusNotFound, "We couldn't find that image or video. Reload the page.")
	case change.Outcome == media.NotAllowed:
		problem(w, http.StatusForbidden, "You can't change media of this company.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": change.Outcome})
	}
}

// deleteMedia: {}: refused while a draft that is approved, scheduled,
// published or failed uses it; the row first, then the file.
func (s *Server) deleteMedia(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session, assetID string) {
	change, err := media.Delete(r.Context(), s.Pool, who.CompanyID, who.UserID, assetID)
	switch {
	case err != nil:
		s.failed(w, "media delete", err)
	case change.Outcome == media.InUse:
		problem(w, http.StatusConflict, describeKeepingMedia(change.Drafts))
	case change.Outcome == media.NotFound:
		problem(w, http.StatusNotFound, "We couldn't find that image or video: it may be deleted already. Reload the page.")
	case change.Outcome == media.NotAllowed:
		problem(w, http.StatusForbidden, "You can't change media of this company.")
	default:
		// A failed file delete leaves a file nothing points at: logged, never retried.
		if err := s.Files.Delete(r.Context(), change.StorageKey); err != nil {
			s.Log.Error("api: media file delete failed", logging.ErrorType(err))
		}
		writeJSON(w, http.StatusOK, map[string]string{"outcome": "deleted"})
	}
}

// describeKeepingMedia: "It can't be deleted while the draft “Lunch menu”
// (Approved) uses it: ...", with what to do when all are approved.
func describeKeepingMedia(drafts []media.DraftUsing) string {
	rule := "It can't be deleted while " + media.DraftsUsingWords(drafts) +
		" it: a draft that is approved, scheduled, published or failed to publish keeps its image or video."
	for _, draft := range drafts {
		if draft.Status != "approved" {
			return rule
		}
	}
	return rule + " Take it off the draft first, or archive the draft (either takes the approval away)."
}

// cancelGeneration: {}: only while it waits to start.
func (s *Server) cancelGeneration(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session, jobID string) {
	outcome, err := mediagen.Cancel(r.Context(), s.Pool, who.CompanyID, who.UserID, jobID)
	switch {
	case err != nil:
		s.failed(w, "generation cancel", err)
	case outcome == "wrong-status":
		problem(w, http.StatusConflict, "It can't be canceled any more: it is being made or already finished. Reload the page to see it.")
	case outcome == "not-found":
		problem(w, http.StatusNotFound, "We couldn't find that request. Reload the page.")
	case outcome == "not-allowed":
		problem(w, http.StatusForbidden, "You can't change media of this company.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": outcome})
	}
}

// startGeneration: {}: "Start now" on a stuck request: CLAIMED before the
// answer (so the page sent back shows it being made, not stuck again),
// and the service asked right after it.
func (s *Server) startGeneration(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session, jobID string) {
	stuck, err := mediagen.IsStuck(r.Context(), s.Pool, who.CompanyID, jobID)
	if err != nil || stuck == nil {
		s.answerUnknownRequest(w, err)
		return
	}
	var claimed *mediagen.Claimed
	outcome := mediagen.NotClaimed
	if *stuck {
		claimed, outcome = s.Studio.Generation.Claim(r.Context(), who.CompanyID, jobID)
	}
	switch {
	case claimed != nil:
		s.Studio.Generation.RunInBackground(who.CompanyID, jobID, claimed)
		writeJSON(w, http.StatusOK, map[string]string{"outcome": "started"})
	case outcome == mediagen.GivenUp:
		// Ended "interrupted": the refreshed page says so in plain words.
		writeJSON(w, http.StatusOK, map[string]string{"outcome": "interrupted"})
	default:
		problem(w, http.StatusConflict, "It isn't stuck: it is being made, or it finished meanwhile. Reload the page to see it.")
	}
}

func (s *Server) answerUnknownRequest(w http.ResponseWriter, err error) {
	if err != nil {
		s.failed(w, "generation", err)
		return
	}
	problem(w, http.StatusNotFound, "We couldn't find that request. Reload the page.")
}
