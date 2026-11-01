package api

import (
	"net/http"

	"ansa/core/internal/cofounder"
	"ansa/core/internal/session"
)

// cofounderOverview: GET, the Co-Founder Overview: the profile's
// completion, the next steps (owners only), the current plan and the
// Getting started checklist (see docs/backend/modules/cofounder.md).
func (s *Server) cofounderOverview(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	overview, err := cofounder.Read(r.Context(), s.Pool, who.CompanyID, who.IsOwner())
	if err != nil {
		s.failed(w, "cofounder overview", err)
		return
	}
	writeJSON(w, http.StatusOK, overview)
}
