package inbox

import (
	"context"

	"ansa/core/internal/database"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// What a change ended in.
const (
	Saved      = "saved"
	Unchanged  = "unchanged"
	NotAllowed = "not-allowed"
	NotFound   = "not-found"
	NotWaiting = "not-waiting"
)

// TakeOver: a person takes the conversation over from ansa (its waiting
// reply, if any, is discarded: ansa no longer answers here).
func TakeOver(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, conversationID string) (string, error) {
	return switchHandler(ctx, pool, company, actorUserID, conversationID, true)
}

// HandBack: a person hands the conversation back to ansa.
func HandBack(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, conversationID string) (string, error) {
	return switchHandler(ctx, pool, company, actorUserID, conversationID, false)
}

func switchHandler(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, conversationID string, takeOver bool) (string, error) {
	outcome := Saved
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role == "" {
			outcome = NotAllowed
			return err
		}
		update := `UPDATE conversations SET handled_by = 'assistant', taken_over_by_user_id = NULL, taken_over_at = NULL
			WHERE company_id = $1 AND id = $2 AND handled_by = 'person'`
		action := "handed_back"
		if takeOver {
			update = `UPDATE conversations SET handled_by = 'person', taken_over_by_user_id = $3, taken_over_at = now()
				WHERE company_id = $1 AND id = $2 AND handled_by = 'assistant'`
			action = "taken_over"
		}
		args := []any{company.String(), conversationID}
		if takeOver {
			args = append(args, actorUserID)
		}
		tag, err := tx.Exec(ctx, update, args...)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			outcome, err = existsOr(ctx, tx, company, conversationID, Unchanged)
			return err
		}
		if err := recordPersonActivity(ctx, tx, company, conversationID, action, actorUserID); err != nil || !takeOver {
			return err
		}
		return discardWaitingRepliesWithin(ctx, tx, company, conversationID, actorUserID)
	})
	return outcome, err
}

// SetImportant marks the person behind the conversation important, or not:
// the assistant never answers them itself, it hands them to you.
func SetImportant(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, conversationID string, important bool) (string, error) {
	outcome := Saved
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role == "" {
			outcome = NotAllowed
			return err
		}
		const update = `
			UPDATE contacts SET important = $3
			WHERE company_id = $1 AND id = (SELECT contact_id FROM conversations WHERE company_id = $1 AND id = $2)`
		tag, err := tx.Exec(ctx, update, company.String(), conversationID, important)
		if err == nil && tag.RowsAffected() == 0 {
			outcome = NotFound
		}
		return err
	})
	return outcome, err
}

// existsOr is `otherwise` when the conversation is the company's, else NotFound.
func existsOr(ctx context.Context, tx database.Tx, company tenant.CompanyID, conversationID, otherwise string) (string, error) {
	var found bool
	err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM conversations WHERE company_id = $1 AND id = $2)`, company.String(), conversationID).Scan(&found)
	if !found {
		return NotFound, err
	}
	return otherwise, err
}

func recordPersonActivity(ctx context.Context, tx database.Tx, company tenant.CompanyID, conversationID, action, actorUserID string) error {
	const insert = `INSERT INTO assistant_activity (company_id, conversation_id, action, actor_user_id) VALUES ($1, $2, $3, $4)`
	_, err := tx.Exec(ctx, insert, company.String(), conversationID, action, actorUserID)
	return err
}

// discardWaitingRepliesWithin: once a person answers the customer or takes
// the conversation over, ansa's waiting reply answers a message they handle
// now, and must never go after theirs. Recorded as their Discard. The
// caller locked the conversation row first, so a reply ansa was saving at
// that moment is seen (and discarded) here.
func discardWaitingRepliesWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, conversationID, actorUserID string) error {
	const statement = `
		UPDATE messages SET send_status = 'discarded'
		WHERE company_id = $1 AND conversation_id = $2 AND author = 'assistant' AND send_status = 'draft'`
	tag, err := tx.Exec(ctx, statement, company.String(), conversationID)
	if err != nil || tag.RowsAffected() == 0 {
		return err
	}
	return recordPersonActivity(ctx, tx, company, conversationID, "draft_discarded", actorUserID)
}
