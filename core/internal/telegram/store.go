package telegram

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// connection is a business's Telegram account, found by Telegram's business
// connection id: the only way a message names its company.
type connection struct {
	CompanyID         tenant.CompanyID
	AccountTelegramID string
}

// findConnection finds the account a business message came through, while
// it is connected (or may not reply). Nil: no ansa company has it.
func findConnection(ctx context.Context, pool *database.Pool, businessConnectionID string) (*connection, error) {
	const statement = `
		-- cross-company: the business connection id Telegram signed names its company; returns that company only.
		SELECT company_id, account_telegram_id FROM channel_connections
		WHERE channel = 'telegram' AND external_id = $1 AND status IN ('connected', 'cannot_reply')`
	var company, account string
	err := pool.QueryRow(ctx, statement, businessConnectionID).Scan(&company, &account)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	id, err := tenant.FromTrustedSource(company)
	if err != nil {
		return nil, err
	}
	return &connection{CompanyID: id, AccountTelegramID: account}, nil
}

// connectedBy is who connected the business's Telegram account in ansa:
// what the business writes in its own app takes a conversation over in
// their name ("" when the account is no longer tied).
func connectedBy(ctx context.Context, pool *database.Pool, company tenant.CompanyID, businessConnectionID string) (string, error) {
	const statement = `
		SELECT connected_by_user_id FROM channel_connections
		WHERE company_id = $1 AND channel = 'telegram' AND external_id = $2 AND status IN ('connected', 'cannot_reply')
		LIMIT 1`
	var userID string
	err := pool.QueryRow(ctx, statement, company.String(), businessConnectionID).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return userID, err
}

// deleteMessages deletes ansa's copies of messages deleted in Telegram.
func deleteMessages(ctx context.Context, pool *database.Pool, company tenant.CompanyID, chatID string, channelMessageIDs []string) error {
	if len(channelMessageIDs) == 0 {
		return nil
	}
	const statement = `
		DELETE FROM messages
		WHERE company_id = $1
			AND body_encrypted IS NOT NULL
			AND channel_message_id = ANY($3)
			AND conversation_id IN (
				SELECT conversations.id FROM conversations
				JOIN contacts ON contacts.id = conversations.contact_id AND contacts.company_id = conversations.company_id
				WHERE conversations.company_id = $1 AND contacts.channel = 'telegram' AND contacts.external_id = $2
			)`
	_, err := pool.Exec(ctx, statement, company.String(), chatID, channelMessageIDs)
	return err
}
