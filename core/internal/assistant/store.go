package assistant

import (
	"context"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
)

// conversationInfo is what a run needs to know about the conversation.
type conversationInfo struct {
	ConversationID string
	Channel        string
	ContactName    *string
	// Someone the owner marked important: always handed to them.
	Important bool
	// Nothing automated was sent or waits here yet: the next message gets the AI label.
	FirstAutomated bool
}

// readGate checks whether the assistant may answer (before asking the
// brain; checked again when saving) and reads the conversation's details.
func (r *Runner) readGate(ctx context.Context, turn conversations.Turn, options GateOptions) (string, conversationInfo, error) {
	info := conversationInfo{ConversationID: turn.ConversationID}
	gate := GateNotFound
	err := database.InTx(ctx, r.Pool, func(tx database.Tx) error {
		var err error
		if gate, err = GateWithin(ctx, tx, turn, options); err != nil || gate == GateNotFound {
			return err
		}
		const statement = `
			SELECT contacts.channel, contacts.display_name, contacts.important,
				NOT EXISTS (
					SELECT 1 FROM messages
					WHERE messages.company_id = $1 AND messages.conversation_id = $2 AND messages.author = 'assistant'
						AND messages.send_status IN ('draft', 'sending', 'sent', 'unclear'))
			FROM conversations
			JOIN contacts ON contacts.id = conversations.contact_id AND contacts.company_id = conversations.company_id
			WHERE conversations.company_id = $1 AND conversations.id = $2`
		return tx.QueryRow(ctx, statement, turn.CompanyID.String(), turn.ConversationID).Scan(&info.Channel, &info.ContactName, &info.Important, &info.FirstAutomated)
	})
	return gate, info, err
}

// markHandledIf records that a message needs nothing more (no reply, or the
// customer's hourly limit), when should is true and nothing failed.
func (r *Runner) markHandledIf(ctx context.Context, turn conversations.Turn, should bool, failure error) error {
	if failure != nil || !should {
		return failure
	}
	return database.InTx(ctx, r.Pool, func(tx database.Tx) error { return MarkHandledWithin(ctx, tx, turn) })
}

// insertOutgoing saves a message from the assistant to the customer.
func insertOutgoing(ctx context.Context, tx database.Tx, turn conversations.Turn, id, bodyEncrypted, status string) error {
	const statement = `
		INSERT INTO messages (id, company_id, conversation_id, direction, author, body_encrypted, send_status)
		VALUES ($1, $2, $3, 'out', 'assistant', $4, $5)`
	_, err := tx.Exec(ctx, statement, id, turn.CompanyID.String(), turn.ConversationID, bodyEncrypted, status)
	return err
}

// discardWaitingDraftsWithin: one waiting reply at a time (a newer one replaces it).
func discardWaitingDraftsWithin(ctx context.Context, tx database.Tx, turn conversations.Turn) error {
	const statement = `
		UPDATE messages SET send_status = 'discarded'
		WHERE company_id = $1 AND conversation_id = $2 AND author = 'assistant' AND send_status = 'draft'`
	_, err := tx.Exec(ctx, statement, turn.CompanyID.String(), turn.ConversationID)
	return err
}

// recordActivity writes one line of what ansa did (reason only on a handover).
func recordActivity(ctx context.Context, tx database.Tx, turn conversations.Turn, action, reason string) error {
	const statement = `
		INSERT INTO assistant_activity (company_id, conversation_id, action, reason)
		VALUES ($1, $2, $3, NULLIF($4, ''))`
	_, err := tx.Exec(ctx, statement, turn.CompanyID.String(), turn.ConversationID, action, reason)
	return err
}

// touchWithin moves the conversation to the top of the Inbox.
func touchWithin(ctx context.Context, tx database.Tx, turn conversations.Turn) error {
	_, err := tx.Exec(ctx, `UPDATE conversations SET last_activity_at = now() WHERE company_id = $1 AND id = $2`, turn.CompanyID.String(), turn.ConversationID)
	return err
}
