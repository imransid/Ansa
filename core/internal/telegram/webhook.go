package telegram

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"net/http"
	"time"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/httpserver"
	"ansa/core/internal/jobs"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

const (
	// Telegram's updates are small: one message of at most 4,096 characters.
	maxBodyBytes = 256 << 10
	secretHeader = "X-Telegram-Bot-Api-Secret-Token"
	// The assistant's job for a customer's message (Phase 2 handles it).
	ReplyJobKind = "assistant.reply"
)

// Every restaurant's messages come from Telegram's few addresses: a ceiling
// against a runaway, checked after the secret.
var webhookLimit = ratelimit.Rule{MaxAttempts: 10_000, Window: time.Minute}

// Webhook handles POST /webhooks/telegram.
type Webhook struct {
	Pool    *database.Pool
	Limiter *ratelimit.Limiter
	Box     *secure.Box
	Log     *logging.Logger
	// TELEGRAM_WEBHOOK_SECRET; empty: every request is refused.
	Secret string
}

// ServeHTTP checks, in this order: size, the secret (constant time), the
// rate limit; then parses and saves. An update ansa can't read is answered
// 200 (Telegram would send it again and again otherwise).
func (h *Webhook) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	body, err := httpserver.ReadBody(r, maxBodyBytes)
	if err == httpserver.ErrTooLarge {
		h.Log.Warn("telegram webhook rejected", logging.Code("too_large"))
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		return
	}
	if err != nil || h.Secret == "" || !sameSecret(r.Header.Get(secretHeader), h.Secret) {
		h.Log.Warn("telegram webhook rejected", logging.Code("wrong_secret"))
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	over, err := h.Limiter.Over(r.Context(), "telegram-webhook", clientIP(r), webhookLimit)
	if err != nil || over {
		h.Log.Warn("telegram webhook rejected", logging.Code("rate_limited"))
		w.WriteHeader(http.StatusTooManyRequests)
		return
	}
	update, err := ParseUpdate(body)
	if err != nil {
		h.Log.Warn("telegram webhook ignored", logging.Code("not_an_update"))
		w.WriteHeader(http.StatusOK)
		return
	}
	if err := h.handle(r.Context(), update); err != nil {
		// 500: Telegram sends it again, and saving is idempotent.
		h.Log.Error("telegram webhook failed", logging.ErrorType(err))
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (h *Webhook) handle(ctx context.Context, update *Update) error {
	switch {
	case update.BusinessMessage != nil:
		return h.handleBusinessMessage(ctx, update.BusinessMessage)
	case update.DeletedMessages != nil:
		return h.handleDeleted(ctx, update.DeletedMessages)
	}
	// Link codes and business connections: links.go.
	return h.handleLinking(ctx, update)
}

// handleBusinessMessage saves a message from one of a business's chats: a
// customer's (then the assistant is asked to answer it, as a job), or one
// the business wrote itself. ansa's own replies coming back are skipped.
func (h *Webhook) handleBusinessMessage(ctx context.Context, message *Message) error {
	if message.BusinessConnectionID == "" || message.Chat.Type != "private" || message.SentByBot || message.From == nil {
		return nil
	}
	found, err := findConnection(ctx, h.Pool, message.BusinessConnectionID)
	if err != nil || found == nil {
		if found == nil && err == nil {
			h.Log.Warn("telegram message ignored", logging.Code("not_connected"))
		}
		return err
	}
	text := message.Describe()
	if text == "" {
		return nil
	}
	saved, err := h.encryptedMessage(found.CompanyID, text, message.MessageID)
	if err != nil {
		return err
	}
	contact := customerContact(message.Chat)
	if message.From.ID == found.AccountTelegramID {
		_, err := conversations.InsertBusinessAccountMessage(ctx, h.Pool, found.CompanyID, contact, saved)
		return err
	}
	turn, err := conversations.InsertCustomerMessage(ctx, h.Pool, found.CompanyID, contact, saved)
	if err != nil || turn == nil {
		return err
	}
	return enqueueReply(ctx, h.Pool, turn)
}

func (h *Webhook) handleDeleted(ctx context.Context, deleted *DeletedMessages) error {
	found, err := findConnection(ctx, h.Pool, deleted.BusinessConnectionID)
	if err != nil || found == nil {
		return err
	}
	return deleteMessages(ctx, h.Pool, found.CompanyID, deleted.ChatID, deleted.MessageIDs)
}

func (h *Webhook) encryptedMessage(company tenant.CompanyID, text, channelMessageID string) (conversations.IncomingMessage, error) {
	id, err := conversations.NewID()
	if err != nil {
		return conversations.IncomingMessage{}, err
	}
	body, err := h.Box.Encrypt(text, conversations.MessageContext(company, id))
	return conversations.IncomingMessage{ID: id, BodyEncrypted: body, ChannelMessageID: channelMessageID}, err
}

// enqueueReply asks the assistant to answer this message, once.
// ReplySettle is how long a reply waits for more messages.
const ReplySettle = 1500 * time.Millisecond

func enqueueReply(ctx context.Context, pool *database.Pool, turn *conversations.Turn) error {
	payload := map[string]string{"conversationId": turn.ConversationID, "triggerMessageId": turn.TriggerMessageID}
	// Customers often send a few messages in a row: the answer starts a
	// moment later, so one answer covers them all (an older message's run
	// then stays quiet).
	job := jobs.NewJob{Kind: ReplyJobKind, Payload: payload, RunAfter: time.Now().Add(ReplySettle), DedupeKey: "reply:" + turn.TriggerMessageID}
	_, err := jobs.Enqueue(ctx, pool, turn.CompanyID, job)
	if err == jobs.ErrDuplicate {
		return nil
	}
	return err
}

func customerContact(chat Chat) conversations.ContactKey {
	contact := conversations.ContactKey{Channel: conversations.ChannelTelegram, ExternalID: chat.ID}
	if name := DisplayName(chat.FirstName, chat.LastName, chat.Username); name != "" {
		cut := cutRunes(name, 200)
		contact.DisplayName = &cut
	}
	return contact
}

// sameSecret compares in constant time (their hashes, so lengths match too).
func sameSecret(given, expected string) bool {
	a := sha256.Sum256([]byte(given))
	b := sha256.Sum256([]byte(expected))
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}

// clientIP is the address the host's proxy reports (x-forwarded-for's first
// entry), else the connection's.
func clientIP(r *http.Request) string {
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		for i := 0; i < len(forwarded); i++ {
			if forwarded[i] == ',' {
				return forwarded[:i]
			}
		}
		return forwarded
	}
	return r.RemoteAddr
}
