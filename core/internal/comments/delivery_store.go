package comments

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/messenger"
	"ansa/core/internal/social"
	"ansa/core/internal/tenant"
)

// claimDelivery marks the start of sending (once): a run that finds it set
// was cut off, and never sends again by itself.
func claimDelivery(ctx context.Context, pool *database.Pool, company tenant.CompanyID, commentRowID string) (bool, error) {
	const statement = `
		UPDATE page_comments SET delivery_started_at = now()
		WHERE company_id = $1 AND id = $2 AND delivery_started_at IS NULL
			AND (public_reply_status = 'sending' OR private_message_status = 'sending')`
	tag, err := pool.Exec(ctx, statement, company.String(), commentRowID)
	return tag.RowsAffected() == 1, err
}

// recordPart records what became of one part ("public" or "private"), only
// over "sending", so a late result never undoes another.
func recordPart(ctx context.Context, pool *database.Pool, company tenant.CompanyID, commentRowID, part string, result messenger.Result) error {
	statement := `
		UPDATE page_comments SET public_reply_status = $3, public_reply_error = NULLIF($4, ''), public_reply_comment_id = NULLIF($5, '')
		WHERE company_id = $1 AND id = $2 AND public_reply_status = 'sending'`
	if part == "private" {
		statement = `
			UPDATE page_comments SET private_message_status = $3, private_message_error = NULLIF($4, ''), private_message_id = NULLIF($5, '')
			WHERE company_id = $1 AND id = $2 AND private_message_status = 'sending'`
	}
	errorCode, id := result.Error, result.ChannelMessageID
	if result.Status == PartSent {
		errorCode = ""
	} else {
		id = ""
	}
	_, err := pool.Exec(ctx, statement, company.String(), commentRowID, result.Status, errorCode, id)
	return err
}

// settleCutOff: what a cut-off run left "sending" may or may not have gone
// out ("unclear"); then the comment's final status.
func settleCutOff(ctx context.Context, pool *database.Pool, company tenant.CompanyID, commentRowID string) error {
	const statement = `
		UPDATE page_comments SET
			public_reply_status = CASE WHEN public_reply_status = 'sending' THEN 'unclear' ELSE public_reply_status END,
			public_reply_error = CASE WHEN public_reply_status = 'sending' THEN 'no_answer' ELSE public_reply_error END,
			private_message_status = CASE WHEN private_message_status = 'sending' THEN 'unclear' ELSE private_message_status END,
			private_message_error = CASE WHEN private_message_status = 'sending' THEN 'no_answer' ELSE private_message_error END
		WHERE company_id = $1 AND id = $2`
	if _, err := pool.Exec(ctx, statement, company.String(), commentRowID); err != nil {
		return err
	}
	_, err := settle(ctx, pool, company, commentRowID)
	return err
}

// settle gives a comment whose parts all went its final status: "failed"
// when every part it tried failed, else "answered".
func settle(ctx context.Context, pool *database.Pool, company tenant.CompanyID, commentRowID string) (string, error) {
	const statement = `
		UPDATE page_comments SET status = CASE
				WHEN COALESCE(public_reply_status, 'failed') = 'failed' AND COALESCE(private_message_status, 'failed') = 'failed' THEN 'failed'
				ELSE 'answered' END
		WHERE company_id = $1 AND id = $2 AND status = 'new'
			AND COALESCE(public_reply_status, '') <> 'sending' AND COALESCE(private_message_status, '') <> 'sending'
		RETURNING status`
	var status string
	err := pool.QueryRow(ctx, statement, company.String(), commentRowID).Scan(&status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return status, err
}

// joinConversation saves the private message, as Meta delivered it, in the
// commenter's Messenger conversation with the Page (made on first use: the
// contact "<page>:<their Page-scoped id>"), so their answer there joins it
// and the assistant carries on as in any chat. A request opened about the
// comment becomes that conversation's, in the same transaction.
func (a *Answerer) joinConversation(ctx context.Context, company tenant.CompanyID, c *comment, result messenger.PrivateReplyResult, text string) error {
	messageID, err := conversations.NewID()
	if err != nil {
		return err
	}
	body, err := a.Box.Encrypt(text, conversations.MessageContext(company, messageID))
	if err != nil {
		return err
	}
	contact := conversations.ContactKey{Channel: conversations.ChannelMessenger, ExternalID: messenger.ContactID(c.PageID, result.RecipientID), DisplayName: c.CommenterName}
	return database.InTx(ctx, a.Pool, func(tx database.Tx) error {
		conversationID, err := conversations.ConversationForWithin(ctx, tx, company, contact)
		if err != nil {
			return err
		}
		if _, err := conversations.InsertSentAssistantMessageWithin(ctx, tx, company, conversationID, messageID, body, result.ChannelMessageID); err != nil {
			return err
		}
		const link = `UPDATE page_comments SET conversation_id = $3 WHERE company_id = $1 AND id = $2`
		if _, err := tx.Exec(ctx, link, company.String(), c.ID, conversationID); err != nil {
			return err
		}
		const request = `UPDATE tickets SET conversation_id = $3 WHERE company_id = $1 AND id = $2 AND conversation_id IS NULL`
		_, err = tx.Exec(ctx, request, company.String(), c.TicketID, conversationID)
		return err
	})
}

// pageToken is the Page's token, read right before the call
// (core/internal/social is the only code that decrypts one).
func (a *Answerer) pageToken(ctx context.Context, company tenant.CompanyID, c *comment) (string, bool) {
	if a.MetaAppSecret == "" {
		return "", false
	}
	token, err := social.PageToken(ctx, a.Pool, a.Box, company, c.ConnectionID)
	return token, err == nil
}

// writeStandIn writes what would go to Meta to a file (development only,
// as the stand-in chats do): nothing leaves this computer. Its id stands in
// for Meta's.
func (a *Answerer) writeStandIn(c *comment, part, text string) messenger.Result {
	if !a.StandInsAllowed || a.StandInDir == "" || os.MkdirAll(a.StandInDir, 0o700) != nil {
		return messenger.Result{Status: PartFailed, Error: "not_connected"}
	}
	to := "facebook-comment:" + c.CommentID
	if part == "private_message" {
		to = "messenger:" + messenger.ContactID(c.PageID, c.CommenterID)
	}
	id := "dev-" + part + "-" + c.ID
	body, _ := json.MarshalIndent(map[string]string{"id": id, "to": to, "text": text}, "", "  ")
	name := time.Now().UTC().Format("2006-01-02T15-04-05.000Z") + "-comment-" + c.ID + "-" + part + ".json"
	if os.WriteFile(filepath.Join(a.StandInDir, name), body, 0o600) != nil {
		return messenger.Result{Status: PartFailed, Error: "not_connected"}
	}
	return messenger.Result{Status: PartSent, ChannelMessageID: id}
}
