// Package api is core's API for the screens: JSON over the private network,
// called only by the Next.js server (never a browser). Every request must
// carry the screens' signature (SCREENS_SHARED_SECRET over the method, the
// path and the body, within 60 seconds) and a logged-in person's session
// cookie, forwarded as it came; the company always comes from that session.
package api

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"ansa/core/internal/assistant"
	"ansa/core/internal/autopost"
	"ansa/core/internal/brainclient"
	"ansa/core/internal/database"
	"ansa/core/internal/files"
	"ansa/core/internal/httpserver"
	"ansa/core/internal/inbound"
	"ansa/core/internal/inbox"
	"ansa/core/internal/logging"
	"ansa/core/internal/orders"
	"ansa/core/internal/outbox"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/secure"
	"ansa/core/internal/session"
	"ansa/core/internal/socialconnect"
)

// The screens send small JSON bodies.
const maxBodyBytes = 64 << 10

// How old a signed request may be.
const signatureWindow = 60 * time.Second

// Server serves the API.
type Server struct {
	Pool     *database.Pool
	Box      *secure.Box
	Sessions *session.Reader
	Limiter  *ratelimit.Limiter
	Log      *logging.Logger
	// SCREENS_SHARED_SECRET; empty: every request is refused.
	Secret  string
	Orders  *orders.StatusChange
	Replies *inbox.Replies
	// The brain, for what it can answer with (Home's "the AI is ready").
	Brain *brainclient.Client
	// The assistant, for "Try your assistant".
	Assistant *assistant.Runner
	// The brain with a time long enough to read a whole menu (120 s a try).
	MenuBrain *brainclient.Client
	// ansa's Telegram bot's username ("" = no bot), whether this is
	// development (stand-ins allowed), and the forwarding addresses' domain.
	TelegramBot      string
	Development      bool
	ForwardingDomain string
	// The outbox, for a request's Retry.
	Outbox *outbox.Deliverer
	// Received emails, for the Emails page's "Process again" and "Make a ticket anyway".
	Inbound *inbound.Processor
	// "Post for me", for "Post one now".
	Posts *autopost.Writer
	// Connecting Facebook Pages.
	Social *socialconnect.Connector
	// The app's own address (invite links).
	AppURL string
	// Private file storage (documents), and ansa's own sending address
	// (never a company's reply-to or support address).
	Files     *files.Store
	EmailFrom string
}

// Register adds every endpoint.
func (s *Server) Register(routes *http.ServeMux) {
	routes.HandleFunc("GET /api/v1/orders", s.withSession(s.listOrders))
	routes.HandleFunc("POST /api/v1/orders/{id}/status", s.withSession(s.changeOrderStatus))
	s.registerInbox(routes)
	s.registerHome(routes)
	s.registerAssistantSettings(routes)
	s.registerSetup(routes)
	s.registerMenu(routes)
	s.registerChannels(routes)
	s.registerRequests(routes)
	s.registerRequestEmails(routes)
	s.registerEmails(routes)
	s.registerPosts(routes)
	s.registerSocial(routes)
	s.registerTeam(routes)
	s.registerSupport(routes)
}

// handler is one endpoint: the request, its body and who is asking.
type handler func(w http.ResponseWriter, r *http.Request, body []byte, who *session.Session)

// withSession checks, in this order: the body's size, the screens'
// signature, the session.
func (s *Server) withSession(h handler) http.HandlerFunc {
	return s.withSessionUpTo(maxBodyBytes, h)
}

// withSessionUpTo is withSession for an endpoint that takes a bigger body
// (a menu's photo).
func (s *Server) withSessionUpTo(maxBytes int64, h handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := httpserver.ReadBody(r, maxBytes)
		if err == httpserver.ErrTooLarge {
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			return
		}
		if err != nil || !s.signedByScreens(r, body, time.Now()) {
			s.Log.Warn("api: request refused", logging.Code("not_signed"))
			w.WriteHeader(http.StatusForbidden)
			return
		}
		who, err := s.Sessions.FromRequest(r.Context(), r)
		if err != nil {
			s.Log.Error("api: session read failed", logging.ErrorType(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if who == nil {
			problem(w, http.StatusUnauthorized, "You're logged out. Log in again.")
			return
		}
		h(w, r, body, who)
	}
}

// SignRequest is the screens' signature: hex HMAC-SHA256 of
// "<unix seconds>.<METHOD> <path?query>.<body>".
func SignRequest(secret, method, uri string, body []byte, at time.Time) (timestamp, signature string) {
	timestamp = strconv.FormatInt(at.Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "." + method + " " + uri + "."))
	mac.Write(body)
	return timestamp, hex.EncodeToString(mac.Sum(nil))
}

func (s *Server) signedByScreens(r *http.Request, body []byte, now time.Time) bool {
	if s.Secret == "" {
		return false
	}
	seconds, err := strconv.ParseInt(r.Header.Get("X-Ansa-Timestamp"), 10, 64)
	if err != nil {
		return false
	}
	at := time.Unix(seconds, 0)
	if now.Sub(at) > signatureWindow || at.Sub(now) > signatureWindow {
		return false
	}
	_, expected := SignRequest(s.Secret, r.Method, r.URL.RequestURI(), body, at)
	given, err := hex.DecodeString(r.Header.Get("X-Ansa-Signature"))
	want, _ := hex.DecodeString(expected)
	return err == nil && hmac.Equal(given, want)
}

// writeJSON answers with a JSON body.
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}

// problem answers an error in words for people: {"error": "..."}.
func problem(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// readJSON reads a body strictly: an unknown field is refused (the screens are ours).
func readJSON(body []byte, into any) bool {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	return decoder.Decode(into) == nil
}

// allowLongAnswer lets one endpoint that waits for the AI answer later than
// the server's 30-second default (only those endpoints; everything else
// keeps the short limit).
func allowLongAnswer(w http.ResponseWriter, d time.Duration) {
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(d))
}
