// Package chat is core's ONE door for sending a message to a customer in a
// chat (Telegram, Messenger, the development stand-in), and for recording
// what became of it. The route is read inside the transaction that saves
// the message (RouteWithin): nothing is saved when it can't go.
package chat

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"time"

	"ansa/core/internal/conversations"
	"ansa/core/internal/messenger"
	"ansa/core/internal/telegram"
	"ansa/core/internal/tenant"
)

// Target is where one message goes.
type Target struct {
	CompanyID  tenant.CompanyID
	Channel    string
	ExternalID string
	// Telegram: the business's connection (stand-in: development only).
	TelegramConnectionID string
	TelegramIsStandIn    bool
	// Messenger: the Page, its connection, and the customer's Page-scoped id.
	MessengerPageID       string
	MessengerConnectionID string
	MessengerPSID         string
	MessengerIsStandIn    bool
}

// Result of one send (Status "sent", "failed" or "unclear"; Error a code).
type Result = telegram.Result

// Sender sends through the right channel.
type Sender struct {
	TelegramToken string
	// ansa's Meta app secret (every Graph call is signed with it), and the
	// Page token reader (core/internal/social: the only code that decrypts one).
	MessengerAppSecret string
	PageToken          func(ctx context.Context, company tenant.CompanyID, connectionID string) (string, error)
	// Development only: stand-ins write to StandInDir instead of sending.
	StandInsAllowed bool
	StandInDir      string
}

// Send sends text to the target. A channel that isn't set up fails
// "not_connected" (never silently).
func (s *Sender) Send(ctx context.Context, target Target, messageID, text string) Result {
	switch {
	case target.Channel == conversations.ChannelStandIn || (target.Channel == conversations.ChannelTelegram && target.TelegramIsStandIn) ||
		(target.Channel == conversations.ChannelMessenger && target.MessengerIsStandIn):
		return s.writeStandIn(messageID, target, text)
	case target.Channel == conversations.ChannelTelegram && target.TelegramConnectionID != "" && s.TelegramToken != "":
		return telegram.Send(ctx, s.TelegramToken, target.ExternalID, text, target.TelegramConnectionID)
	case target.Channel == conversations.ChannelMessenger && target.MessengerConnectionID != "":
		return s.sendMessenger(ctx, target, text)
	default:
		return Result{Status: "failed", Error: "not_connected"}
	}
}

// sendMessenger reads the Page's token first: a Page that can't be used now
// (disconnected, its token unreadable) means the message isn't sent.
func (s *Sender) sendMessenger(ctx context.Context, target Target, text string) Result {
	if s.MessengerAppSecret == "" || s.PageToken == nil {
		return Result{Status: "failed", Error: "not_connected"}
	}
	token, err := s.PageToken(ctx, target.CompanyID, target.MessengerConnectionID)
	if err != nil {
		return Result{Status: "failed", Error: "not_connected"}
	}
	sent := messenger.Send(ctx, s.MessengerAppSecret, target.MessengerPageID, token, target.MessengerPSID, text)
	return Result{Status: sent.Status, ChannelMessageID: sent.ChannelMessageID, Error: sent.Error}
}

// writeStandIn writes the message to a file (development), as the old
// adapters/dev-chat-outbox.ts does.
func (s *Sender) writeStandIn(messageID string, target Target, text string) Result {
	if !s.StandInsAllowed || s.StandInDir == "" {
		return Result{Status: "failed", Error: "not_connected"}
	}
	if err := os.MkdirAll(s.StandInDir, 0o700); err != nil {
		return Result{Status: "failed", Error: "not_connected"}
	}
	body, _ := json.MarshalIndent(map[string]string{"id": messageID, "to": target.Channel + ":" + target.ExternalID, "text": text}, "", "  ")
	name := time.Now().UTC().Format("2006-01-02T15-04-05.000Z") + "-" + messageID + ".json"
	if err := os.WriteFile(filepath.Join(s.StandInDir, name), body, 0o600); err != nil {
		return Result{Status: "failed", Error: "not_connected"}
	}
	return Result{Status: "sent"}
}
