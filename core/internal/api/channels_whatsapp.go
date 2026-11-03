package api

import (
	"errors"
	"net/http"
	"time"

	"ansa/core/internal/session"
	"ansa/core/internal/settings"
	"ansa/core/internal/whatsapp"
)

// WhatsApp Business (step 56): owners connect the company's number with
// Meta's Embedded Signup (the page opens Meta's window; core checks what it
// reports with Meta before saving anything), or a stand-in in development,
// and disconnect it.

func (s *Server) registerWhatsApp(routes *http.ServeMux) {
	routes.HandleFunc("POST /api/v1/channels/whatsapp/connect", s.withSession(s.ownersOnly("Only owners connect WhatsApp.", s.whatsappConnect)))
	routes.HandleFunc("POST /api/v1/channels/whatsapp/stand-in", s.withSession(s.ownersOnly("Only owners connect WhatsApp.", s.whatsappStandIn)))
	routes.HandleFunc("POST /api/v1/channels/whatsapp/disconnect", s.withSession(s.ownersOnly("Only owners disconnect WhatsApp.", s.whatsappDisconnect)))
}

// whatsappMode: "real", "stand-in" or "not-set-up" (whatsapp.Connector.Mode).
func (s *Server) whatsappMode() string {
	if s.WhatsApp == nil {
		return "not-set-up"
	}
	return s.WhatsApp.Mode()
}

// whatsappSignup is what the page needs to open Meta's sign-up window
// (public values: Meta's script shows them to every visitor), only when
// ansa's Meta app is set up for it.
func (s *Server) whatsappSignup() map[string]string {
	if s.whatsappMode() != "real" {
		return nil
	}
	return map[string]string{"appId": s.WhatsApp.AppID, "configId": s.WhatsApp.SignupConfigID}
}

// What the page says when Meta didn't confirm a sign-up.
var signupProblems = map[string]string{
	whatsapp.SignupCodeRefused:     "Meta's sign-up ran out or was already used. Press Connect WhatsApp again.",
	whatsapp.SignupNotGranted:      "Meta didn't give ansa access to that WhatsApp account. Press Connect WhatsApp again and allow ansa.",
	whatsapp.SignupNumberUnknown:   "Meta didn't confirm that number. Press Connect WhatsApp again and pick your number.",
	whatsapp.SignupSubscribeFailed: "Meta didn't let ansa receive this number's messages. Try again in a minute.",
	whatsapp.SignupRegisterFailed:  "WhatsApp didn't accept the number for ansa. If it has a two-step verification PIN, turn it off in WhatsApp Manager and connect again.",
	whatsapp.SignupNoAnswer:        "Meta didn't answer. Try again in a minute.",
}

// whatsappConnect: POST {code, wabaId, phoneNumberId} (what Meta's window
// reported: claims until Meta confirms them).
func (s *Server) whatsappConnect(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		Code          string `json:"code"`
		WABAID        string `json:"wabaId"`
		PhoneNumberID string `json:"phoneNumberId"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	if s.whatsappMode() != "real" {
		problem(w, http.StatusConflict, "WhatsApp isn't set up by ansa yet.")
		return
	}
	// Up to five calls to Meta, each with its own time limit.
	allowLongAnswer(w, 2*time.Minute)
	outcome, err := s.WhatsApp.Connect(r.Context(), who.CompanyID, who.UserID, whatsapp.Signup{Code: input.Code, WABAID: input.WABAID, PhoneNumberID: input.PhoneNumberID})
	var refused *whatsapp.SignupError
	switch {
	case errors.As(err, &refused):
		problem(w, http.StatusUnprocessableEntity, signupProblems[refused.Code])
	default:
		s.answerConnected(w, outcome, err)
	}
}

// whatsappStandIn: development without ansa's Meta app only.
func (s *Server) whatsappStandIn(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	if s.whatsappMode() != "stand-in" {
		problem(w, http.StatusConflict, "A stand-in number is only for development without ansa's Meta app.")
		return
	}
	outcome, err := s.WhatsApp.ConnectStandIn(r.Context(), who.CompanyID, who.UserID)
	s.answerConnected(w, outcome, err)
}

func (s *Server) answerConnected(w http.ResponseWriter, outcome string, err error) {
	switch {
	case err != nil:
		s.failed(w, "whatsapp connect", err)
	case outcome == whatsapp.AlreadyConnected:
		problem(w, http.StatusConflict, "A WhatsApp number is already connected. Disconnect it first.")
	case outcome == whatsapp.ConnectedElsewhere:
		problem(w, http.StatusConflict, "This number is connected in another ansa account. Disconnect it there first.")
	case outcome != settings.Saved:
		problem(w, http.StatusForbidden, "Only owners connect WhatsApp.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{})
	}
}

func (s *Server) whatsappDisconnect(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	outcome, err := whatsapp.Disconnect(r.Context(), s.Pool, who.CompanyID, who.UserID)
	s.answerSaved(w, outcome, err, "Only owners disconnect WhatsApp.")
}
