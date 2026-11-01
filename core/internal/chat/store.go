package chat

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
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
// Messenger joins with its module. Returns the target or a refusal.
func RouteWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, conversationID string) (Target, string, error) {
	const conversation = `
		SELECT contacts.channel, contacts.external_id,
			COALESCE(conversations.last_customer_message_at > now() - interval '24 hours', false)
		FROM conversations
		JOIN contacts ON contacts.id = conversations.contact_id AND contacts.company_id = conversations.company_id
		WHERE conversations.company_id = $1 AND conversations.id = $2
		FOR UPDATE OF conversations`
	var target Target
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
