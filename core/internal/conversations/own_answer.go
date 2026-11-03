package conversations

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// InsertBusinessAccountMessage saves a message the business wrote in its own
// app (Telegram, Meta Business Suite, the WhatsApp Business app): sent, no
// teammate named. You answered yourself, so ansa steps back
// (stepBackWithin). holderUserID: who connected that account in ansa. False
// when it was saved before.
func InsertBusinessAccountMessage(ctx context.Context, pool *database.Pool, company tenant.CompanyID, contact ContactKey, message IncomingMessage, holderUserID string) (bool, error) {
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
		// Also locks the conversation row: a reply ansa is saving at this
		// moment is seen below (and discarded), or ansa finds it taken over.
		if err := touchConversation(ctx, tx, company, conversationID, false); err != nil {
			return err
		}
		return stepBackWithin(ctx, tx, company, conversationID, holderUserID)
	})
	return saved, err
}

// stepBackWithin: answering yourself means you're handling it (the owner's
// direction). ansa's wait to step in ends, and its reply waiting for
// approval is discarded: it answered a message you answered, and must never
// go after yours. Where ansa answers every message ("Always"), the
// conversation is also taken over, as a person's reply in ansa takes it,
// until someone hands it back; with "Only when I'm away" ansa answers the
// next messages as that setting says. A take over records a person (the
// database's rule): the one who connected the account. The activity lines
// name no one: nobody did anything in ansa.
func stepBackWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, conversationID, holderUserID string) error {
	always, err := answersEveryMessageWithin(ctx, tx, company)
	if err != nil {
		return err
	}
	if always && holderUserID != "" {
		if err := takeOverForTheBusinessWithin(ctx, tx, company, conversationID, holderUserID); err != nil {
			return err
		}
	}
	const stopWaiting = `UPDATE conversations SET assistant_due_at = NULL WHERE company_id = $1 AND id = $2`
	if _, err := tx.Exec(ctx, stopWaiting, company.String(), conversationID); err != nil {
		return err
	}
	return discardWaitingRepliesWithin(ctx, tx, company, conversationID)
}

// answersEveryMessageWithin: ansa answers every message ("Always", a
// business's default, also before anything is saved), not only while you're
// away.
func answersEveryMessageWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID) (bool, error) {
	var answerWhen string
	err := tx.QueryRow(ctx, `SELECT answer_when FROM assistant_settings WHERE company_id = $1`, company.String()).Scan(&answerWhen)
	if errors.Is(err, pgx.ErrNoRows) {
		return true, nil
	}
	return answerWhen != "when_away", err
}

// takeOverForTheBusinessWithin takes the conversation over from ansa, as a
// person's reply in ansa does; one already taken over stays as it is.
func takeOverForTheBusinessWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, conversationID, holderUserID string) error {
	const takeOver = `
		UPDATE conversations SET handled_by = 'person', taken_over_by_user_id = $3, taken_over_at = now()
		WHERE company_id = $1 AND id = $2 AND handled_by = 'assistant'`
	tag, err := tx.Exec(ctx, takeOver, company.String(), conversationID, holderUserID)
	if err != nil || tag.RowsAffected() == 0 {
		return err
	}
	return recordAppActivityWithin(ctx, tx, company, conversationID, "taken_over")
}

// discardWaitingRepliesWithin: ansa's replies waiting for approval ("Ask me
// first") never go after the business's own answer.
func discardWaitingRepliesWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, conversationID string) error {
	const statement = `
		UPDATE messages SET send_status = 'discarded'
		WHERE company_id = $1 AND conversation_id = $2 AND author = 'assistant' AND send_status = 'draft'`
	tag, err := tx.Exec(ctx, statement, company.String(), conversationID)
	if err != nil || tag.RowsAffected() == 0 {
		return err
	}
	return recordAppActivityWithin(ctx, tx, company, conversationID, "draft_discarded")
}

// recordAppActivityWithin writes a line of the conversation's history with
// no actor: ansa's app did it, not a teammate.
func recordAppActivityWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, conversationID, action string) error {
	const insert = `INSERT INTO assistant_activity (company_id, conversation_id, action) VALUES ($1, $2, $3)`
	_, err := tx.Exec(ctx, insert, company.String(), conversationID, action)
	return err
}
