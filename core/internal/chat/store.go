package chat

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/messenger"
	"ansa/core/internal/tenant"
)

// Why a reply can't go (nothing is saved then).
const (
	RefusedNotFound     = "not-found"
	RefusedNotChat      = "not-chat"
	RefusedNotConnected = "not-connected"
	RefusedCannotReply  = "cannot-reply"
	RefusedWindowClosed = "window-closed"
)

// RouteWithin reads, and locks, where a reply to this conversation's customer
// goes: Telegram needs the company's account connected, allowed to reply,
// and the customer's last message under 24 hours old (Telegram's rule).
// Messenger needs the Page connected and allowed to send messages, within 24
// hours too. Returns the target or a refusal.
func RouteWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, conversationID string) (Target, string, error) {
	const conversation = `
		SELECT contacts.channel, contacts.external_id,
			COALESCE(conversations.last_customer_message_at > now() - interval '24 hours', false)
		FROM conversations
		JOIN contacts ON contacts.id = conversations.contact_id AND contacts.company_id = conversations.company_id
		WHERE conversations.company_id = $1 AND conversations.id = $2
		FOR UPDATE OF conversations`
	target := Target{CompanyID: company}
	var windowOpen bool
	err := tx.QueryRow(ctx, conversation, company.String(), conversationID).Scan(&target.Channel, &target.ExternalID, &windowOpen)
	if errors.Is(err, pgx.ErrNoRows) {
		return Target{}, RefusedNotFound, nil
	}
	if err != nil {
		return Target{}, "", err
	}
	switch target.Channel {
	case "stand_in":
		return target, "", nil
	case "telegram":
		return telegramRoute(ctx, tx, company, target, windowOpen)
	case "messenger":
		return messengerRoute(ctx, tx, company, target, windowOpen)
	default:
		return Target{}, RefusedNotChat, nil
	}
}

func telegramRoute(ctx context.Context, tx database.Tx, company tenant.CompanyID, target Target, windowOpen bool) (Target, string, error) {
	const account = `
		SELECT external_id, status, is_stand_in FROM channel_connections
		WHERE company_id = $1 AND channel = 'telegram' AND status <> 'disconnected'
		FOR SHARE`
	var status string
	err := tx.QueryRow(ctx, account, company.String()).Scan(&target.TelegramConnectionID, &status, &target.TelegramIsStandIn)
	if errors.Is(err, pgx.ErrNoRows) || status == "removed_in_telegram" {
		return Target{}, RefusedNotConnected, nil
	}
	if err != nil {
		return Target{}, "", err
	}
	if status == "cannot_reply" {
		return Target{}, RefusedCannotReply, nil
	}
	if !windowOpen {
		return Target{}, RefusedWindowClosed, nil
	}
	return target, "", nil
}

// messengerRoute: the Page the customer wrote to, connected in this company
// and allowed to send messages (pages_messaging granted, or a development
// stand-in), and the customer's last message under 24 hours (Meta's rule).
func messengerRoute(ctx context.Context, tx database.Tx, company tenant.CompanyID, target Target, windowOpen bool) (Target, string, error) {
	pageID, psid, ok := messenger.SplitContactID(target.ExternalID)
	if !ok {
		return Target{}, RefusedNotConnected, nil
	}
	const page = `
		SELECT id, is_stand_in, is_stand_in OR 'pages_messaging' = ANY(scopes) FROM social_connections
		WHERE company_id = $1 AND platform = 'facebook' AND external_account_id = $2 AND status = 'connected'
		FOR SHARE`
	var canMessage bool
	err := tx.QueryRow(ctx, page, company.String(), pageID).Scan(&target.MessengerConnectionID, &target.MessengerIsStandIn, &canMessage)
	if errors.Is(err, pgx.ErrNoRows) {
		return Target{}, RefusedNotConnected, nil
	}
	if err != nil {
		return Target{}, "", err
	}
	if !canMessage {
		return Target{}, RefusedCannotReply, nil
	}
	if !windowOpen {
		return Target{}, RefusedWindowClosed, nil
	}
	target.MessengerPageID, target.MessengerPSID = pageID, psid
	return target, "", nil
}

// RecordDelivery records what became of a message saved "sending": only over
// "sending", so a late result never undoes another.
func RecordDelivery(ctx context.Context, pool *database.Pool, company tenant.CompanyID, messageID string, result Result) error {
	const statement = `
		UPDATE messages SET
			send_status = $3,
			send_error = CASE WHEN $3 = 'sent' THEN NULL ELSE $4 END,
			channel_message_id = CASE WHEN $3 = 'sent' THEN NULLIF($5, '') ELSE NULL END
		WHERE company_id = $1 AND id = $2 AND send_status = 'sending'`
	_, err := pool.Exec(ctx, statement, company.String(), messageID, result.Status, result.Error, result.ChannelMessageID)
	return err
}
