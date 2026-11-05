package api

import (
	"net/http"
	"strings"

	"ansa/core/internal/devices"
	"ansa/core/internal/session"
	"ansa/core/internal/settings"
)

// The website's side of the ansa phone app (core/internal/devices): the
// connected phones, the QR code that connects one, and "Answer for me when
// my phone is unreachable for N minutes". Everyone reads; owners change.
func (s *Server) registerDevices(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/devices", s.withSession(s.devicesPage))
	routes.HandleFunc("POST /api/v1/devices/pair-code", s.withSession(s.ownersOnly("Only owners connect phones.", s.devicePairCode)))
	routes.HandleFunc("POST /api/v1/devices/settings", s.withSession(s.ownersOnly("Only owners change this setting.", s.deviceSettings)))
	routes.HandleFunc("POST /api/v1/devices/{id}/remove", s.withSession(s.ownersOnly("Only owners remove phones.", s.removeDevice)))
}

// devicesPage: GET /api/v1/devices -> {devices, followPhone, waitMinutes, canChange, phoneAway}.
func (s *Server) devicesPage(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	page, err := devices.ReadPage(r.Context(), s.Pool, who.CompanyID, who.IsOwner())
	if err != nil {
		s.failed(w, "devices", err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

// devicePairCode: POST /api/v1/devices/pair-code {} -> {code, expiresAt,
// link, qr}: a one-time code for 5 minutes, the link holding core's
// address for phones (DEVICE_API_URL), and its QR code's modules.
func (s *Server) devicePairCode(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	if len(body) > 0 && !readJSON(body, &struct{}{}) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	code, outcome, err := devices.MakePairCode(r.Context(), s.Pool, who.CompanyID, who.UserID, s.DeviceAPIURL)
	switch {
	case err != nil:
		s.failed(w, "pair code", err)
	case outcome != settings.Saved:
		problem(w, http.StatusForbidden, "Only owners connect phones.")
	default:
		writeJSON(w, http.StatusOK, code)
	}
}

// deviceSettings: POST /api/v1/devices/settings {"followPhone": bool,
// "waitMinutes": 1|5|15|30} -> {"outcome": "saved"}.
func (s *Server) deviceSettings(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		FollowPhone *bool `json:"followPhone"`
		WaitMinutes int   `json:"waitMinutes"`
	}
	if !readJSON(body, &input) || input.FollowPhone == nil || !devices.WaitMinutesAllowed(input.WaitMinutes) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	outcome, err := devices.SaveSettings(r.Context(), s.Pool, who.CompanyID, who.UserID, *input.FollowPhone, input.WaitMinutes)
	switch {
	case err != nil:
		s.failed(w, "device settings", err)
	case outcome != settings.Saved:
		problem(w, http.StatusForbidden, "Only owners change this setting.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": "saved"})
	}
}

// removeDevice: POST /api/v1/devices/{id}/remove {} -> {"outcome":
// "removed" | "changed"} ("changed": removed already, by the phone or
// another owner, or not this company's).
func (s *Server) removeDevice(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	id := strings.ToLower(r.PathValue("id"))
	if !uuidPattern.MatchString(id) || (len(body) > 0 && !readJSON(body, &struct{}{})) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	outcome, err := devices.Remove(r.Context(), s.Pool, who.CompanyID, who.UserID, id)
	switch {
	case err != nil:
		s.failed(w, "remove device", err)
	case outcome == settings.NotAllowed:
		problem(w, http.StatusForbidden, "Only owners remove phones.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"outcome": outcome})
	}
}
