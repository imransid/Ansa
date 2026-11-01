package inbox

import (
	"context"
	"strings"

	"ansa/core/internal/chat"
	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/secure"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// ReplyMaxLength is the longest reply a person may write.
const ReplyMaxLength = 4000

// Replies sends what people write, and the assistant's waiting replies.
type Replies struct {
	Pool   *database.Pool
	Box    *secure.Box
	Sender *chat.Sender
}

// CleanReply is the reply as typed (a line break counted once, stored as
// "\n"), trimmed; "" with a reason in words when it can't be sent.
func CleanReply(text string) (string, string) {
	cleaned, problem := plaintext.Note(text, ReplyMaxLength)
	switch {
	case problem != "" && strings.HasPrefix(problem, "At most"):
		return "", "A reply can be at most 4,000 characters."
	case problem != "":
		return "", problem
	case cleaned == "":
		return "", "Write a reply first."
	}
	return cleaned, ""
}

// Reply saves a person's reply "sending" (encrypted), then sends it and
// records what became of it. Replying takes the conversation over from ansa,
// and ends ansa's wait to step in. replacesDraftID: the assistant's waiting
// reply this one replaces (an edit), discarded in the same transaction. A
// reply that can't go now (a chat refusal) saves nothing: the outcome says why.
func (r *Replies) Reply(ctx context.Context, company tenant.CompanyID, actorUserID, conversationID, text, replacesDraftID string) (string, error) {
	messageID, err := conversations.NewID()
	if err != nil {
		return "", err
	}
	body, err := r.Box.Encrypt(text, conversations.MessageContext(company, messageID))
	if err != nil {
		return "", err
	}
	outcome := Saved
	var target chat.Target
	err = database.InTx(ctx, r.Pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role == "" {
			outcome = NotAllowed
			return err
		}
		var refusal string
		if target, refusal, err = chat.RouteWithin(ctx, tx, company, conversationID); err != nil || refusal != "" {
			outcome = refusal
			return err
		}
		if replacesDraftID != "" {
			if _, err := discardDraftWithin(ctx, tx, company, conversationID, replacesDraftID); err != nil {
				return err
			}
		}
		return savePersonReplyWithin(ctx, tx, company, actorUserID, conversationID, messageID, body)
	})
	if err != nil || outcome != Saved {
		return outcome, err
	}
	return Saved, r.deliver(ctx, company, target, messageID, text)
}

// savePersonReplyWithin: ansa's wait ends, the conversation is taken over
// when ansa had it, and the reply is saved to be sent.
func savePersonReplyWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, actorUserID, conversationID, messageID, body string) error {
	const takeOver = `
		UPDATE conversations SET handled_by = 'person', taken_over_by_user_id = $3, taken_over_at = now(), assistant_due_at = NULL
		WHERE company_id = $1 AND id = $2 AND handled_by = 'assistant'`
	tag, err := tx.Exec(ctx, takeOver, company.String(), conversationID, actorUserID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 1 {
		if err := recordPersonActivity(ctx, tx, company, conversationID, "taken_over", actorUserID); err != nil {
			return err
		}
	} else if _, err := tx.Exec(ctx, `UPDATE conversations SET assistant_due_at = NULL WHERE company_id = $1 AND id = $2`, company.String(), conversationID); err != nil {
		return err
	}
	const insert = `
		INSERT INTO messages (id, company_id, conversation_id, direction, author, author_user_id, body_encrypted, send_status)
		VALUES ($1, $2, $3, 'out', 'person', $4, $5, 'sending')`
	if _, err := tx.Exec(ctx, insert, messageID, company.String(), conversationID, actorUserID, body); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE conversations SET last_activity_at = now() WHERE company_id = $1 AND id = $2`, company.String(), conversationID)
	return err
}

// SendDraft sends one of the assistant's waiting replies as it wrote it
// (it stays the assistant's, approved: the conversation isn't taken over).
func (r *Replies) SendDraft(ctx context.Context, company tenant.CompanyID, actorUserID, conversationID, messageID string) (string, error) {
	outcome := Saved
	var target chat.Target
	var body string
	err := database.InTx(ctx, r.Pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role == "" {
			outcome = NotAllowed
			return err
		}
		var refusal string
		if target, refusal, err = chat.RouteWithin(ctx, tx, company, conversationID); err != nil || refusal != "" {
			outcome = refusal
			return err
		}
		const claim = `
			UPDATE messages SET send_status = 'sending'
			WHERE company_id = $1 AND conversation_id = $2 AND id = $3 AND author = 'assistant' AND send_status = 'draft'
			RETURNING body_encrypted`
		if err := tx.QueryRow(ctx, claim, company.String(), conversationID, messageID).Scan(&body); err != nil {
			outcome = NotWaiting
			return ignoreNoRows(err)
		}
		if err := recordPersonActivity(ctx, tx, company, conversationID, "draft_sent", actorUserID); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE conversations SET last_activity_at = now() WHERE company_id = $1 AND id = $2`, company.String(), conversationID)
		return err
	})
	if err != nil || outcome != Saved {
		return outcome, err
	}
	text, err := r.Box.Decrypt(body, conversations.MessageContext(company, messageID))
	if err != nil {
		return Saved, chat.RecordDelivery(ctx, r.Pool, company, messageID, chat.Result{Status: "failed", Error: "not_connected"})
	}
	return Saved, r.deliver(ctx, company, target, messageID, text)
}

// DiscardDraft: the customer never gets this waiting reply (kept as "discarded").
func (r *Replies) DiscardDraft(ctx context.Context, company tenant.CompanyID, actorUserID, conversationID, messageID string) (string, error) {
	outcome := Saved
	err := database.InTx(ctx, r.Pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role == "" {
			outcome = NotAllowed
			return err
		}
		discarded, err := discardDraftWithin(ctx, tx, company, conversationID, messageID)
		if err != nil || !discarded {
			outcome = NotWaiting
			return err
		}
		return recordPersonActivity(ctx, tx, company, conversationID, "draft_discarded", actorUserID)
	})
	return outcome, err
}

func discardDraftWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, conversationID, messageID string) (bool, error) {
	const statement = `
		UPDATE messages SET send_status = 'discarded'
		WHERE company_id = $1 AND conversation_id = $2 AND id = $3 AND author = 'assistant' AND send_status = 'draft'`
	tag, err := tx.Exec(ctx, statement, company.String(), conversationID, messageID)
	return tag.RowsAffected() == 1, err
}

func (r *Replies) deliver(ctx context.Context, company tenant.CompanyID, target chat.Target, messageID, text string) error {
	return chat.RecordDelivery(ctx, r.Pool, company, messageID, r.Sender.Send(ctx, target, messageID, text))
}
