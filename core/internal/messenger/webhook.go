package messenger

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"regexp"
	"strings"
	"time"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/httpserver"
	"ansa/core/internal/jobs"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/secure"
)

// Meta batches events; a batch of text messages stays far below this.
const maxBodyBytes = 512 << 10

// Every business's messages come from Meta's addresses: a ceiling against a
// runaway, checked after the signature.
var webhookLimit = ratelimit.Rule{MaxAttempts: 10_000, Window: time.Minute}

// Webhook is Meta's Messenger webhook (POST /webhooks/messenger) and its
// one-time setup check (GET).
type Webhook struct {
	Pool    *database.Pool
	Limiter *ratelimit.Limiter
	Box     *secure.Box
	Log     *logging.Logger
	// ansa's Meta app; without its secret every request is refused.
	AppID, AppSecret string
	// MESSENGER_VERIFY_TOKEN; without it the setup check is refused.
	VerifyToken string
}

// ServeHTTP checks, in this order: size, Meta's signature over the raw
// bytes (constant time), the rate limit; then parses and saves. One ansa
// can't read is answered 200 (Meta would send it again and again).
func (h *Webhook) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, err := httpserver.ReadBody(r, maxBodyBytes)
	if err == httpserver.ErrTooLarge {
		h.Log.Warn("messenger webhook rejected", logging.Code("too_large"))
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		return
	}
	if err != nil || h.AppSecret == "" || !IsMetasSignature(r.Header.Get("X-Hub-Signature-256"), body, h.AppSecret) {
		h.Log.Warn("messenger webhook rejected", logging.Code("bad_signature"))
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	over, err := h.Limiter.Over(r.Context(), "messenger-webhook", httpserver.ClientIP(r), webhookLimit)
	if err != nil || over {
		h.Log.Warn("messenger webhook rejected", logging.Code("rate_limited"))
		w.WriteHeader(http.StatusTooManyRequests)
		return
	}
	events, err := ParseEvents(body)
	if err != nil {
		h.Log.Warn("messenger webhook ignored", logging.Code("not_for_ansa"))
		w.WriteHeader(http.StatusOK)
		return
	}
	for _, event := range events {
		if err := h.handle(r.Context(), event); err != nil {
			// 500: Meta sends it again, and saving is idempotent (one row per mid).
			h.Log.Error("messenger webhook failed", logging.ErrorType(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
	}
	w.WriteHeader(http.StatusOK)
}

// IsMetasSignature: "sha256=" + HMAC-SHA256 of the raw body with the app
// secret, compared in constant time.
func IsMetasSignature(header string, body []byte, appSecret string) bool {
	if !strings.HasPrefix(header, "sha256=") {
		return false
	}
	mac := hmac.New(sha256.New, []byte(appSecret))
	mac.Write(body)
	return sameSecret(strings.ToLower(header), "sha256="+hex.EncodeToString(mac.Sum(nil)))
}

var challengePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,200}$`)

// Verify answers Meta's setup check with its challenge, only for ansa's
// verify token (constant time).
func (h *Webhook) Verify(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	challenge := query.Get("hub.challenge")
	if h.VerifyToken == "" || query.Get("hub.mode") != "subscribe" || !sameSecret(query.Get("hub.verify_token"), h.VerifyToken) || !challengePattern.MatchString(challenge) {
		h.Log.Warn("messenger webhook verification refused")
		w.WriteHeader(http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "text/plain")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(challenge))
}

// handle saves one message. The company comes ONLY from the Page id Meta
// signed, and only when exactly one company has that Page connected.
func (h *Webhook) handle(ctx context.Context, event Event) error {
	page, err := findPage(ctx, h.Pool, event.PageID)
	if err != nil || page == nil {
		if err == nil {
			h.Log.Warn("messenger message ignored", logging.Code("page_not_connected_once"))
		}
		return err
	}
	text := event.Describe()
	if text == "" {
		return nil
	}
	id, err := conversations.NewID()
	if err != nil {
		return err
	}
	body, err := h.Box.Encrypt(text, conversations.MessageContext(page.CompanyID, id))
	if err != nil {
		return err
	}
	saved := conversations.IncomingMessage{ID: id, BodyEncrypted: body, ChannelMessageID: event.MID}
	if event.IsEcho {
		// The Page's own message, unless ansa's app sent it (saved already).
		if h.AppID == "" || event.AppID != h.AppID {
			_, err = conversations.InsertBusinessAccountMessage(ctx, h.Pool, page.CompanyID, contactKey(event.PageID, event.RecipientID), saved)
		}
		return err
	}
	if event.RecipientID != event.PageID {
		return nil
	}
	turn, err := conversations.InsertCustomerMessage(ctx, h.Pool, page.CompanyID, contactKey(event.PageID, event.SenderID), saved)
	if err != nil || turn == nil {
		return err
	}
	payload := NamePayload{ConversationID: turn.ConversationID, ConnectionID: page.ConnectionID, PSID: event.SenderID}
	_, err = jobs.Enqueue(ctx, h.Pool, page.CompanyID, jobs.NewJob{Kind: NameJobKind, Payload: payload, MaxAttempts: 2, DedupeKey: "name:" + turn.ConversationID})
	if err == jobs.ErrDuplicate {
		return nil
	}
	return err
}

func contactKey(pageID, psid string) conversations.ContactKey {
	return conversations.ContactKey{Channel: conversations.ChannelMessenger, ExternalID: ContactID(pageID, psid)}
}

// sameSecret compares in constant time (their hashes, so lengths match too).
func sameSecret(given, expected string) bool {
	a := sha256.Sum256([]byte(given))
	b := sha256.Sum256([]byte(expected))
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}
