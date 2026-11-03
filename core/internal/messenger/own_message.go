package messenger

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// SavePagesOwnMessage saves a message the business wrote on its Facebook
// Page (an echo ansa's app didn't send: Meta Business Suite, the Page's
// inbox) in the customer's conversation, as the business's own: ansa steps
// back as conversations.InsertBusinessAccountMessage says, a take over in
// the name of whoever connected the Page. The development practice chat
// saves the stand-in Page's with it too.
func SavePagesOwnMessage(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, event Event) error {
	saved, err := encryptedMessage(box, company, event)
	if err != nil || saved == nil {
		return err
	}
	holder, err := pageConnectedBy(ctx, pool, company, event.PageID)
	if err != nil {
		return err
	}
	_, err = conversations.InsertBusinessAccountMessage(ctx, pool, company, contactKey(event.PageID, event.RecipientID), *saved, holder)
	return err
}

// encryptedMessage is the event's text encrypted for a new message id, or
// nil when there is nothing to keep.
func encryptedMessage(box *secure.Box, company tenant.CompanyID, event Event) (*conversations.IncomingMessage, error) {
	text := event.Describe()
	if text == "" {
		return nil, nil
	}
	id, err := conversations.NewID()
	if err != nil {
		return nil, err
	}
	body, err := box.Encrypt(text, conversations.MessageContext(company, id))
	if err != nil {
		return nil, err
	}
	return &conversations.IncomingMessage{ID: id, BodyEncrypted: body, ChannelMessageID: event.MID}, nil
}

// pageConnectedBy is who connected the Page in this company ("" for none).
func pageConnectedBy(ctx context.Context, pool *database.Pool, company tenant.CompanyID, pageID string) (string, error) {
	const statement = `
		SELECT connected_by_user_id FROM social_connections
		WHERE company_id = $1 AND platform = 'facebook' AND external_account_id = $2 AND status = 'connected'`
	var userID string
	err := pool.QueryRow(ctx, statement, company.String(), pageID).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return userID, err
}
