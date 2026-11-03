package api

import (
	"net/http"

	"ansa/core/internal/channels"
	"ansa/core/internal/conversations"
	"ansa/core/internal/session"
	"ansa/core/internal/settings"
)

func (s *Server) registerChannels(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/channels", s.withSession(s.channelsPage))
	routes.HandleFunc("POST /api/v1/channels/telegram/link", s.withSession(s.ownersOnly("Only owners connect Telegram.", s.telegramLink)))
	routes.HandleFunc("POST /api/v1/channels/telegram/stand-in", s.withSession(s.ownersOnly("Only owners connect Telegram.", s.telegramStandIn)))
	routes.HandleFunc("POST /api/v1/channels/telegram/disconnect", s.withSession(s.ownersOnly("Only owners disconnect Telegram.", s.telegramDisconnect)))
	s.registerWhatsApp(routes)
}

// telegramMode: "real" with ansa's bot, "stand-in" in development without
// it, "not-set-up" in production without it.
func (s *Server) telegramMode() string {
	switch {
	case s.TelegramBot != "":
		return "real"
	case s.Development:
		return "stand-in"
	}
	return "not-set-up"
}

// channelsPage: GET /api/v1/channels, everyone reads it.
func (s *Server) channelsPage(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	page, err := channels.Read(r.Context(), s.Pool, who.CompanyID, s.ForwardingDomain)
	if err != nil {
		s.failed(w, "channels", err)
		return
	}
	facebookMode := "not-set-up"
	if s.Social != nil {
		facebookMode = s.Social.Mode("facebook")
	}
	writeJSON(w, http.StatusOK, map[string]any{"page": page, "canManage": who.IsOwner(), "telegramMode": s.telegramMode(), "facebookMode": facebookMode,
		"whatsappMode": s.whatsappMode(), "whatsappSignup": s.whatsappSignup()})
}

// telegramLink: a one-time link to ansa's bot ({"link"}), 10 minutes.
func (s *Server) telegramLink(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	if s.telegramMode() != "real" {
		problem(w, http.StatusConflict, "Telegram isn't set up by ansa yet.")
		return
	}
	code, outcome, err := channels.TelegramLink(r.Context(), s.Pool, who.CompanyID, who.UserID)
	switch {
	case err != nil:
		s.failed(w, "telegram link", err)
	case outcome != settings.Saved:
		problem(w, http.StatusForbidden, "Only owners connect Telegram.")
	default:
		writeJSON(w, http.StatusOK, map[string]string{"link": "https://t.me/" + s.TelegramBot + "?start=" + code})
	}
}

// telegramStandIn: development without ansa's bot only.
func (s *Server) telegramStandIn(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	if s.telegramMode() != "stand-in" {
		problem(w, http.StatusConflict, "A stand-in account is only for development without ansa's bot.")
		return
	}
	id, err := conversations.NewID()
	if err != nil {
		s.failed(w, "telegram stand-in", err)
		return
	}
	outcome, err := channels.ConnectStandIn(r.Context(), s.Pool, who.CompanyID, who.UserID, "stand-in:"+id)
	switch {
	case err != nil:
		s.failed(w, "telegram stand-in", err)
	case outcome == channels.AlreadyConnected:
		problem(w, http.StatusConflict, "A Telegram account is already connected.")
	default:
		s.answerSaved(w, outcome, nil, "Only owners connect Telegram.")
	}
}

func (s *Server) telegramDisconnect(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	outcome, err := channels.DisconnectTelegram(r.Context(), s.Pool, who.CompanyID, who.UserID)
	s.answerSaved(w, outcome, err, "Only owners disconnect Telegram.")
}
