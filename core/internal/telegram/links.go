package telegram

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"ansa/core/internal/logging"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/ratelimit"
)

// How a business connects its Telegram account (the old
// services/telegram-updates.ts): an owner presses "Connect Telegram" in ansa
// and gets a one-time link with a code; their Start in ansa's bot CLAIMS the
// code with their Telegram user id; the chatbot they add in Telegram (from
// that same user) is then tied to the code's company. The company comes ONLY
// from a code ansa made: nothing Telegram sends names one. The code goes from
// ansa to Telegram, never back, so a leaked code can at worst tie the
// leaker's own account to the owner's company, never take a business's chats.

// After the Start, ansa waits this long for the chatbot to be added (and
// keeps a chatbot added before the Start as long).
const linkWaitMinutes = 60

// At most 10 messages to the bot's own chat per Telegram user per 10 minutes.
var botChatLimit = ratelimit.Rule{MaxAttempts: 10, Window: 10 * time.Minute}

// What the bot tells the owner in its own chat. Fixed text: never a
// customer's words, never anything another company could be told.
var botNotes = struct {
	WaitingForChatbot, Connected, ConnectedCannotReply, LinkExpired, NeedsLink, ElsewhereConnected, CompanyHasAnother string
}{
	WaitingForChatbot:    "Thanks! Now add me as your chatbot: Telegram Settings → Telegram Business → Chatbots, type my username, choose the chats, and allow me to reply. If I'm already there, remove me and add me again.",
	Connected:            "Connected to ansa. Your customers' messages now show in ansa's Inbox.",
	ConnectedCannotReply: "Connected to ansa, but I'm not allowed to reply. Allow it under Telegram Business → Chatbots so ansa can answer your customers.",
	LinkExpired:          "This link has expired or was used already. Open ansa → Settings → Connections and press Connect Telegram again.",
	NeedsLink:            "To use me with ansa, open ansa → Settings → Connections and press Connect Telegram.",
	ElsewhereConnected:   "This Telegram account is connected to another ansa account. Disconnect it there first.",
	CompanyHasAnother:    "Your ansa account already has another Telegram account connected. Disconnect it in ansa first.",
}

// HashLinkCode is what a link code is stored as: its SHA-256, as hex. No
// secret key is needed: the code is 256 random bits.
func HashLinkCode(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}

// "/start <code>" (also "/start@botname <code>"); the code is 43 characters.
var startPattern = regexp.MustCompile(`^/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{43})$`)

func readStartCode(text string) string {
	match := startPattern.FindStringSubmatch(strings.TrimSpace(text))
	if match == nil {
		return ""
	}
	return match[1]
}

func (h *Webhook) handleLinking(ctx context.Context, update *Update) error {
	switch {
	case update.Message != nil:
		return h.handleBotChat(ctx, update.Message)
	case update.BusinessConnection != nil:
		return h.handleConnection(ctx, update.BusinessConnection)
	}
	return nil
}

// handleBotChat: a message to the bot in its own chat: the owner's Start
// with the code, or anything else from anyone (told how to connect).
func (h *Webhook) handleBotChat(ctx context.Context, message *Message) error {
	if message.Chat.Type != "private" || message.From == nil || message.From.IsBot {
		return nil
	}
	over, err := h.Limiter.Over(ctx, "telegram-bot-chat", message.From.ID, botChatLimit)
	if err != nil || over {
		return err
	}
	code := readStartCode(message.Text)
	if code == "" {
		h.notify(message.Chat.ID, botNotes.NeedsLink)
		return nil
	}
	claimed, err := claimLinkCode(ctx, h.Pool, HashLinkCode(code), message.From.ID)
	if err != nil || claimed == nil {
		if err == nil {
			h.notify(message.Chat.ID, botNotes.LinkExpired)
		}
		return err
	}
	// The chatbot may have been added before this Start: it waits as pending.
	pending, err := findPendingConnection(ctx, h.Pool, message.From.ID)
	if err != nil || pending == nil {
		if err == nil {
			h.notify(message.Chat.ID, botNotes.WaitingForChatbot)
		}
		return err
	}
	outcome, err := linkAccount(ctx, h.Pool, *claimed, *pending)
	if err == nil {
		h.notify(pending.AccountChatID, noteFor(outcome))
	}
	return err
}

// handleConnection: the business's account added, changed or removed the bot.
func (h *Webhook) handleConnection(ctx context.Context, connection *BusinessConnection) error {
	facts := accountFactsOf(connection)
	known, err := updateLinkedAccount(ctx, h.Pool, facts, connection.IsEnabled)
	if err != nil || known {
		return err
	}
	if !connection.IsEnabled {
		return deletePendingConnection(ctx, h.Pool, facts.ExternalID)
	}
	claimed, err := findClaimedCode(ctx, h.Pool, facts.AccountTelegramID)
	if err != nil {
		return err
	}
	if claimed == nil {
		// Added before the Start: kept for an hour, until a code names the company.
		if err := savePendingConnection(ctx, h.Pool, facts); err != nil {
			return err
		}
		h.notify(facts.AccountChatID, botNotes.NeedsLink)
		return nil
	}
	outcome, err := linkAccount(ctx, h.Pool, *claimed, facts)
	if err == nil {
		h.notify(facts.AccountChatID, noteFor(outcome))
	}
	return err
}

// accountFacts is what ansa keeps of a business's Telegram account.
type accountFacts struct {
	ExternalID, AccountTelegramID, AccountChatID, DisplayName string
	CanReply                                                  bool
}

func accountFactsOf(c *BusinessConnection) accountFacts {
	name := plaintext.SingleLine(DisplayName(c.User.FirstName, c.User.LastName, c.User.Username))
	if utf8.RuneCountInString(name) > 200 {
		name = strings.TrimSpace(string([]rune(name)[:200]))
	}
	if name == "" {
		name = "Telegram account"
	}
	return accountFacts{ExternalID: c.ID, AccountTelegramID: c.User.ID, AccountChatID: c.UserChatID, DisplayName: name, CanReply: c.CanReply}
}

func noteFor(outcome string) string {
	switch outcome {
	case linkConnected:
		return botNotes.Connected
	case linkCannotReply:
		return botNotes.ConnectedCannotReply
	case linkElsewhere:
		return botNotes.ElsewhereConnected
	case linkCompanyHasAnother:
		return botNotes.CompanyHasAnother
	}
	return botNotes.LinkExpired
}

// notify sends a note from the bot after the webhook's answer (best effort:
// a note that fails is logged as a code).
func (h *Webhook) notify(chatID, text string) {
	if h.Notify != nil {
		h.Notify(chatID, text)
		return
	}
	if h.BotToken == "" {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if result := Send(ctx, h.BotToken, chatID, text, ""); result.Status != "sent" {
			h.Log.Warn("telegram note not sent", logging.Code(result.Error))
		}
	}()
}
