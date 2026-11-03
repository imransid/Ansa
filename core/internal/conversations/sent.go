package conversations

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// ConversationForWithin is the contact's conversation, made with its
// contact on first use, inside the caller's transaction.
func ConversationForWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, contact ContactKey) (string, error) {
	return conversationForContact(ctx, tx, company, contact)
}

// InsertSentAssistantMessageWithin saves, as ansa's, a message ansa already
// sent to the customer by another way than the conversation's own route:
// the private reply to their Facebook comment (core/internal/comments),
// which Meta delivers in their Messenger chat with the Page. It is "sent",
// with Meta's id, once per that id, and moves the conversation up the Inbox
// (never the customer's reply window: only their own message opens it).
// False when it was saved before.
func InsertSentAssistantMessageWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, conversationID, id, bodyEncrypted, channelMessageID string) (bool, error) {
	const insert = `
		INSERT INTO messages (id, company_id, conversation_id, direction, author, body_encrypted, send_status, channel_message_id)
		VALUES ($1, $2, $3, 'out', 'assistant', $4, 'sent', $5)
		ON CONFLICT (conversation_id, channel_message_id) DO NOTHING
		RETURNING id`
	var saved string
	err := tx.QueryRow(ctx, insert, id, company.String(), conversationID, bodyEncrypted, channelMessageID).Scan(&saved)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, touchConversation(ctx, tx, company, conversationID, false)
}
