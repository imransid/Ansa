package whatsapp

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/httpserver"
	"ansa/core/internal/logging"
	"ansa/core/internal/messenger"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// Meta batches events; a batch of text messages stays far below this.
const maxBodyBytes = 512 << 10

// Every business's messages come from Meta's addresses: a ceiling against a
// runaway, checked after the signature.
var webhookLimit = ratelimit.Rule{MaxAttempts: 10_000, Window: time.Minute}

// Webhook is Meta's WhatsApp webhook (POST /webhooks/whatsapp) and its
// one-time setup check (GET).
type Webhook struct {
	Pool    *database.Pool
	Limiter *ratelimit.Limiter
	Box     *secure.Box
	Log     *logging.Logger
	// ansa's Meta app secret; without it every request is refused.
	AppSecret string
	// WHATSAPP_VERIFY_TOKEN; without it the setup check is refused.
	VerifyToken string
}

// ServeHTTP checks, in this order: size, Meta's signature over the raw
// bytes (constant time), the rate limit; then parses and saves. One ansa
// can't read is answered 200 (Meta would send it again and again).
func (h *Webhook) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, err := httpserver.ReadBody(r, maxBodyBytes)
	if err == httpserver.ErrTooLarge {
		h.Log.Warn("whatsapp webhook rejected", logging.Code("too_large"))
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		return
	}
	// The same signature as Messenger's: ansa's one Meta app signs both.
	if err != nil || h.AppSecret == "" || !messenger.IsMetasSignature(r.Header.Get("X-Hub-Signature-256"), body, h.AppSecret) {
		h.Log.Warn("whatsapp webhook rejected", logging.Code("bad_signature"))
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	over, err := h.Limiter.Over(r.Context(), "whatsapp-webhook", httpserver.ClientIP(r), webhookLimit)
	if err != nil || over {
		h.Log.Warn("whatsapp webhook rejected", logging.Code("rate_limited"))
		w.WriteHeader(http.StatusTooManyRequests)
		return
	}
	events, err := ParseEvents(body)
	if err != nil {
		h.Log.Warn("whatsapp webhook ignored", logging.Code("not_for_ansa"))
		w.WriteHeader(http.StatusOK)
		return
	}
	for _, event := range events {
		if err := h.handle(r.Context(), event); err != nil {
			// 500: Meta sends it again, and saving is idempotent (one row per message id).
			h.Log.Error("whatsapp webhook failed", logging.ErrorType(err))
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
	}
	w.WriteHeader(http.StatusOK)
}

var challengePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,200}$`)

// Verify answers Meta's setup check with its challenge, only for ansa's
// verify token (constant time).
func (h *Webhook) Verify(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	challenge := query.Get("hub.challenge")
	if h.VerifyToken == "" || query.Get("hub.mode") != "subscribe" || !sameSecret(query.Get("hub.verify_token"), h.VerifyToken) || !challengePattern.MatchString(challenge) {
		h.Log.Warn("whatsapp webhook verification refused")
		w.WriteHeader(http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "text/plain")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(challenge))
}

// handle saves one event. The company comes ONLY from what Meta signed: the
// phone number id (a message, an echo) or the business account id (an
// account change), and only from numbers connected in exactly one company.
func (h *Webhook) handle(ctx context.Context, event Event) error {
	if event.Kind == KindAccount {
		return followAccountChange(ctx, h.Pool, event.WABAID, event.NewStatus)
	}
	number, err := findNumber(ctx, h.Pool, event.PhoneNumberID)
	if err != nil || number == nil {
		if err == nil {
			h.Log.Warn("whatsapp message ignored", logging.Code("number_not_connected_once"))
		}
		return err
	}
	return SaveEvent(ctx, h.Pool, h.Box, number.CompanyID, event)
}

// SaveEvent saves a customer's message in their conversation (the
// assistant's answer queued with it) or the business's own message written
// in the WhatsApp Business app (you answered: ansa steps back as
// conversations.InsertBusinessAccountMessage says, a take over in the name
// of whoever connected the number), encrypted, once per WhatsApp message id.
// The simulator and the practice chat save the stand-in number's messages
// with it too.
func SaveEvent(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, event Event) error {
	text := event.Describe()
	if text == "" {
		return nil
	}
	id, err := conversations.NewID()
	if err != nil {
		return err
	}
	body, err := box.Encrypt(text, conversations.MessageContext(company, id))
	if err != nil {
		return err
	}
	saved := conversations.IncomingMessage{ID: id, BodyEncrypted: body, ChannelMessageID: event.MessageID}
	contact := conversations.ContactKey{Channel: conversations.ChannelWhatsApp, ExternalID: ContactID(event.PhoneNumberID, event.CustomerID)}
	if event.Kind == KindEcho {
		holder, err := numberConnectedBy(ctx, pool, company, event.PhoneNumberID)
		if err != nil {
			return err
		}
		_, err = conversations.InsertBusinessAccountMessage(ctx, pool, company, contact, saved, holder)
		return err
	}
	if name := cleanName(event.CustomerName); name != "" {
		contact.DisplayName = &name
	}
	_, err = conversations.InsertCustomerMessage(ctx, pool, company, contact, saved)
	return err
}

// cleanName is the customer's name as one plain line of at most 200
// characters, or "" (WhatsApp lets a person write anything there).
func cleanName(name string) string {
	clean := strings.TrimSpace(plaintext.SingleLine(name))
	if utf8.RuneCountInString(clean) > 200 {
		return ""
	}
	return clean
}

// sameSecret compares in constant time (their hashes, so lengths match too).
func sameSecret(given, expected string) bool {
	a := sha256.Sum256([]byte(given))
	b := sha256.Sum256([]byte(expected))
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}
