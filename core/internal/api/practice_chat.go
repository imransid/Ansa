package api

import (
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"ansa/core/internal/inbox"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/practicechat"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/session"
)

// The practice chat (step 58, development only): an owner writes as a
// made-up customer through the company's stand-in accounts and reads the
// chat as that customer sees it (core/internal/practicechat): a demo's
// customer side, in the browser. Real customers write on the channels an
// owner connects.

var practiceChatMessages = ratelimit.Rule{MaxAttempts: 300, Window: time.Hour}

const practiceChatOnly = "The practice chat is for development only: real customers write on your connected channels."

func (s *Server) registerPracticeChat(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/practice/chat", s.withSession(s.practiceChat))
	routes.HandleFunc("POST /api/v1/practice/chat", s.withSession(s.withPracticeChat(s.sendPracticeChat)))
	routes.HandleFunc("GET /api/v1/practice/chat/find", s.withSession(s.withPracticeChat(s.findPracticeChat)))
	routes.HandleFunc("GET /api/v1/practice/chat/{id}", s.withSession(s.withPracticeChat(s.readPracticeChat)))
	routes.HandleFunc("POST /api/v1/practice/email", s.withSessionUpTo(practiceEmailBodyBytes, s.withPracticeChat(s.sendPracticeEmail)))
}

// practiceChat: GET: {available (development, and an owner), isOwner,
// standIns: {whatsapp, telegram, messenger}, email (the practice email
// works here: real email is off)}.
func (s *Server) practiceChat(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	available := s.Development && who.IsOwner()
	standIns := map[string]bool{}
	if available {
		var err error
		if standIns, err = practicechat.StandIns(r.Context(), s.Pool, who.CompanyID); err != nil {
			s.failed(w, "practice chat", err)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"available": available, "isOwner": who.IsOwner(), "standIns": standIns, "email": available && s.practiceInbox() != ""})
}

// withPracticeChat lets only an owner use it, and only in development.
func (s *Server) withPracticeChat(h handler) handler {
	return func(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
		switch {
		case !s.Development:
			problem(w, http.StatusForbidden, practiceChatOnly)
		case !who.IsOwner():
			problem(w, http.StatusForbidden, "Only owners can use the practice chat.")
		default:
			h(w, r, body, who)
		}
	}
}

// sendPracticeChat: POST {channel, name, text, asBusiness}: {conversationId}.
// asBusiness: the business answers the customer from its own app instead
// (the customer wrote first).
func (s *Server) sendPracticeChat(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session) {
	var input struct {
		Channel    string `json:"channel"`
		Name       string `json:"name"`
		Text       string `json:"text"`
		AsBusiness bool   `json:"asBusiness"`
	}
	if !readJSON(body, &input) {
		problem(w, http.StatusBadRequest, "Something went wrong. Reload the page.")
		return
	}
	name := strings.TrimSpace(plaintext.SingleLine(input.Name))
	text := strings.TrimSpace(strings.ReplaceAll(input.Text, "\x00", ""))
	fields := map[string]string{}
	if !slices.Contains(practicechat.Channels, input.Channel) {
		fields["channel"] = "Pick WhatsApp, Telegram or Messenger."
	}
	if name == "" || utf8.RuneCountInString(name) > 100 {
		fields["name"] = "Write the customer's name (up to 100 characters)."
	}
	if text == "" || utf8.RuneCountInString(text) > 4000 {
		fields["text"] = "Write a message (up to 4,000 characters)."
	}
	if len(fields) > 0 {
		fieldProblems(w, fields)
		return
	}
	if over, err := s.Limiter.Over(r.Context(), "practice-chats", who.CompanyID.String(), practiceChatMessages); err != nil || over {
		problem(w, http.StatusTooManyRequests, "That's a lot of practice messages this hour. Try again later.")
		return
	}
	conversationID, err := s.sendPracticeMessage(r, who, input.Channel, name, text, input.AsBusiness)
	switch {
	case errors.Is(err, practicechat.ErrNoStandIn):
		problem(w, http.StatusConflict, "Connect a stand-in account for this channel on Settings → Connections first.")
	case errors.Is(err, practicechat.ErrNoConversation):
		problem(w, http.StatusConflict, "Write as the customer first: the business answers them.")
	case err != nil:
		s.failed(w, "practice chat", err)
	default:
		writeJSON(w, http.StatusOK, map[string]string{"conversationId": conversationID})
	}
}

// sendPracticeMessage saves the customer's message, or the business's own
// answer from its app: the conversation it is in.
func (s *Server) sendPracticeMessage(r *http.Request, who *session.Session, channel, name, text string, asBusiness bool) (string, error) {
	if asBusiness {
		return practicechat.SendAsBusiness(r.Context(), s.Pool, s.Box, s.Log, who.CompanyID, channel, name, text)
	}
	turn, err := practicechat.Send(r.Context(), s.Pool, s.Box, who.CompanyID, channel, name, text)
	if err != nil {
		return "", err
	}
	return turn.ConversationID, nil
}

// findPracticeChat: GET ?channel=&name=: {conversationId} ("" before the
// customer's first message).
func (s *Server) findPracticeChat(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	channel := r.URL.Query().Get("channel")
	name := strings.TrimSpace(plaintext.SingleLine(r.URL.Query().Get("name")))
	if !slices.Contains(practicechat.Channels, channel) || name == "" || utf8.RuneCountInString(name) > 100 {
		writeJSON(w, http.StatusOK, map[string]string{"conversationId": ""})
		return
	}
	id, err := practicechat.Find(r.Context(), s.Pool, who.CompanyID, channel, name)
	if err != nil {
		s.failed(w, "practice chat", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"conversationId": id})
}

// readPracticeChat: GET: {lines}, the chat as the customer sees it.
func (s *Server) readPracticeChat(w http.ResponseWriter, r *http.Request, _ []byte, who *session.Session) {
	id := r.PathValue("id")
	if !uuidPattern.MatchString(id) {
		problem(w, http.StatusNotFound, "This chat isn't here.")
		return
	}
	lines, err := practicechat.Read(r.Context(), s.Pool, s.Box, who.CompanyID, strings.ToLower(id))
	switch {
	case errors.Is(err, inbox.ErrNotFound):
		problem(w, http.StatusNotFound, "This chat isn't here.")
	case err != nil:
		s.failed(w, "practice chat", err)
	default:
		writeJSON(w, http.StatusOK, map[string]any{"lines": lines})
	}
}
