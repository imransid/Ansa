package conversations

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// InsertCustomerMessage saves a customer's chat message in their
// conversation (made with its contact on first use), once per channel
// message id. It returns nil when the same message arrived before.
func InsertCustomerMessage(ctx context.Context, pool *database.Pool, company tenant.CompanyID, contact ContactKey, message IncomingMessage) (*Turn, error) {
	var turn *Turn
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		conversationID, err := conversationForContact(ctx, tx, company, contact)
		if err != nil {
			return err
		}
		const insert = `
			INSERT INTO messages (id, company_id, conversation_id, direction, author, body_encrypted, channel_message_id)
			VALUES ($1, $2, $3, 'in', 'customer', $4, $5)
			ON CONFLICT (conversation_id, channel_message_id) DO NOTHING
			RETURNING id`
		var id string
		err = tx.QueryRow(ctx, insert, message.ID, company.String(), conversationID, message.BodyEncrypted, message.ChannelMessageID).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if err := touchConversation(ctx, tx, company, conversationID, true); err != nil {
			return err
		}
		turn = &Turn{CompanyID: company, ConversationID: conversationID, TriggerMessageID: id}
		return nil
	})
	return turn, err
}

// InsertBusinessAccountMessage saves a message the business wrote in its own
// app (Telegram, Meta Business Suite): sent, no teammate named. You answered
// yourself, so the assistant stops waiting to step in. False when it was
// saved before.
func InsertBusinessAccountMessage(ctx context.Context, pool *database.Pool, company tenant.CompanyID, contact ContactKey, message IncomingMessage) (bool, error) {
	saved := false
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		conversationID, err := conversationForContact(ctx, tx, company, contact)
		if err != nil {
			return err
		}
		const insert = `
			INSERT INTO messages (id, company_id, conversation_id, direction, author, body_encrypted, send_status, channel_message_id)
			VALUES ($1, $2, $3, 'out', 'business_account', $4, 'sent', $5)
			ON CONFLICT (conversation_id, channel_message_id) DO NOTHING`
		tag, err := tx.Exec(ctx, insert, message.ID, company.String(), conversationID, message.BodyEncrypted, message.ChannelMessageID)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		saved = true
		if err := touchConversation(ctx, tx, company, conversationID, false); err != nil {
			return err
		}
		const stopWaiting = `UPDATE conversations SET assistant_due_at = NULL WHERE company_id = $1 AND id = $2`
		_, err = tx.Exec(ctx, stopWaiting, company.String(), conversationID)
		return err
	})
	return saved, err
}

// conversationForContact returns the contact's conversation, making both on
// first use. Two saves at once for a new contact end on one conversation.
func conversationForContact(ctx context.Context, tx database.Tx, company tenant.CompanyID, contact ContactKey) (string, error) {
	const insertContact = `
		INSERT INTO contacts (company_id, channel, external_id, display_name)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (company_id, channel, external_id) DO NOTHING`
	if _, err := tx.Exec(ctx, insertContact, company.String(), contact.Channel, contact.ExternalID, contact.DisplayName); err != nil {
		return "", err
	}
	const findContact = `SELECT id FROM contacts WHERE company_id = $1 AND channel = $2 AND external_id = $3`
	var contactID string
	if err := tx.QueryRow(ctx, findContact, company.String(), contact.Channel, contact.ExternalID).Scan(&contactID); err != nil {
		return "", err
	}
	const insertConversation = `
		INSERT INTO conversations (company_id, contact_id) VALUES ($1, $2)
		ON CONFLICT (company_id, contact_id) DO NOTHING`
	if _, err := tx.Exec(ctx, insertConversation, company.String(), contactID); err != nil {
		return "", err
	}
	const findConversation = `SELECT id FROM conversations WHERE company_id = $1 AND contact_id = $2`
	var conversationID string
	err := tx.QueryRow(ctx, findConversation, company.String(), contactID).Scan(&conversationID)
	return conversationID, err
}

// touchConversation moves the conversation up the Inbox; a customer's
// message also restarts the platforms' 24-hour reply window.
func touchConversation(ctx context.Context, tx database.Tx, company tenant.CompanyID, conversationID string, fromCustomer bool) error {
	const statement = `
		UPDATE conversations SET
			last_activity_at = now(),
			last_customer_message_at = CASE WHEN $3 THEN now() ELSE last_customer_message_at END
		WHERE company_id = $1 AND id = $2`
	_, err := tx.Exec(ctx, statement, company.String(), conversationID, fromCustomer)
	return err
}

// LinkInboundEmailWithin makes a received email (and its request) an entry
// of its sender's conversation: a link, never a copy of the email, and
// ansa's "email_made_request" line.
func LinkInboundEmailWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, contact ContactKey, inboundEmailID, ticketID string) error {
	conversationID, err := conversationForContact(ctx, tx, company, contact)
	if err != nil {
		return err
	}
	companyText, conversation := company.String(), conversationID
	if _, err := tx.Exec(ctx, `INSERT INTO messages (company_id, conversation_id, direction, author, inbound_email_id) VALUES ($1, $2, 'in', 'customer', $3)`,
		companyText, conversation, inboundEmailID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE inbound_emails SET conversation_id = $2 WHERE company_id = $1 AND id = $3`, companyText, conversation, inboundEmailID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE tickets SET conversation_id = $2 WHERE company_id = $1 AND id = $3`, companyText, conversation, ticketID); err != nil {
		return err
	}
	if err := touchConversation(ctx, tx, company, conversation, false); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO assistant_activity (company_id, conversation_id, action) VALUES ($1, $2, 'email_made_request')`, companyText, conversation)
	return err
}
