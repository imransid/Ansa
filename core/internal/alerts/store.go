package alerts

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/assistant"
	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

type owner struct{ ID, Name, Email string }

// alertDetails is everything one alert reads, all of one company.
type alertDetails struct {
	Channel          string
	CustomerName     *string
	HoldingReplySent bool
	AlertByEmail     bool
	CompanyName      string
	// The account's kind ("business" or "personal"): how the reason is worded.
	Kind           string
	TelegramChatID string
	Owners         []owner
}

// readDetails is a conversation's alert details: who and where, whether
// the holding reply reached them, and the company's.
func readDetails(ctx context.Context, pool *database.Pool, company tenant.CompanyID, payload assistant.AlertPayload) (alertDetails, error) {
	var conversationPart alertDetails
	id := company.String()
	const conversation = `
		SELECT contacts.channel, contacts.display_name
		FROM conversations
		JOIN contacts ON contacts.id = conversations.contact_id AND contacts.company_id = conversations.company_id
		WHERE conversations.company_id = $1 AND conversations.id = $2`
	if err := pool.QueryRow(ctx, conversation, id, payload.ConversationID).Scan(&conversationPart.Channel, &conversationPart.CustomerName); err != nil {
		return conversationPart, err
	}
	if payload.HoldingMessageID != "" {
		const holding = `SELECT COALESCE(send_status = 'sent', false) FROM messages WHERE company_id = $1 AND id = $2`
		if err := pool.QueryRow(ctx, holding, id, payload.HoldingMessageID).Scan(&conversationPart.HoldingReplySent); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return conversationPart, err
		}
	}
	details, err := readCompanyDetails(ctx, pool, company)
	details.Channel, details.CustomerName, details.HoldingReplySent = conversationPart.Channel, conversationPart.CustomerName, conversationPart.HoldingReplySent
	return details, err
}

// readCompanyDetails is what every alert reads of the company: whether
// owners want emails, its name and kind, its Telegram chat, its owners.
func readCompanyDetails(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (alertDetails, error) {
	details := alertDetails{AlertByEmail: true}
	id := company.String()
	if err := pool.QueryRow(ctx, `SELECT alert_by_email FROM assistant_settings WHERE company_id = $1`, id).Scan(&details.AlertByEmail); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return details, err
	}
	const name = `
		SELECT COALESCE(NULLIF((SELECT confirmed_value FROM business_facts WHERE company_id = $1 AND topic = 'company_name'), ''), name), kind
		FROM companies WHERE id = $1`
	if err := pool.QueryRow(ctx, name, id).Scan(&details.CompanyName, &details.Kind); err != nil {
		return details, err
	}
	const chat = `
		SELECT account_chat_id FROM channel_connections
		WHERE company_id = $1 AND channel = 'telegram' AND status NOT IN ('disconnected', 'removed_in_telegram')
			AND is_stand_in = false AND account_chat_id IS NOT NULL
		LIMIT 1`
	if err := pool.QueryRow(ctx, chat, id).Scan(&details.TelegramChatID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return details, err
	}
	owners, err := listOwnersToAlert(ctx, pool, company)
	details.Owners = owners
	return details, err
}

// listOwnersToAlert: confirmed, active owners only (an unconfirmed address may not be theirs).
func listOwnersToAlert(ctx context.Context, pool *database.Pool, company tenant.CompanyID) ([]owner, error) {
	const statement = `
		SELECT id, name, email FROM users
		WHERE company_id = $1 AND role = 'owner' AND email_verified = true AND deactivated_at IS NULL
		ORDER BY created_at`
	rows, err := pool.Query(ctx, statement, company.String())
	if err != nil {
		return nil, err
	}
	var owners []owner
	for rows.Next() {
		var o owner
		if err := rows.Scan(&o.ID, &o.Name, &o.Email); err != nil {
			return nil, err
		}
		owners = append(owners, o)
	}
	return owners, rows.Err()
}
