package settings

import (
	"context"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// SetAway: "I'm away" (since now) or "I'm back". "I'm away" means ansa
// answers for you everywhere, in the same transaction: every conversation
// a person took over is handed back, and every message waiting out its
// minutes is answered at the catch-up's next round.
func SetAway(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, away bool) (string, error) {
	return AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		const upsert = `
			INSERT INTO assistant_settings (company_id, away_since, updated_by_user_id) VALUES ($1, CASE WHEN $2 THEN now() END, $3)
			ON CONFLICT (company_id) DO UPDATE SET away_since = CASE WHEN $2 THEN now() END, updated_by_user_id = $3, updated_at = now()`
		if _, err := tx.Exec(ctx, upsert, company.String(), away, actorUserID); err != nil || !away {
			return err
		}
		if err := handBackEveryConversationWithin(ctx, tx, company, actorUserID); err != nil {
			return err
		}
		return endEveryWaitWithin(ctx, tx, company)
	})
}

// handBackEveryConversationWithin: a reply in ansa takes a conversation
// over for good, so without this ansa would stay quiet there while you're
// away. Each one gets the line "Hand back" writes, by whoever pressed "I'm away".
func handBackEveryConversationWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, actorUserID string) error {
	const statement = `
		WITH handed_back AS (
			UPDATE conversations SET handled_by = 'assistant', taken_over_by_user_id = NULL, taken_over_at = NULL
			WHERE company_id = $1 AND handled_by = 'person'
			RETURNING id
		)
		INSERT INTO assistant_activity (company_id, conversation_id, action, actor_user_id)
		SELECT $1, id, 'handed_back', $2 FROM handed_back`
	_, err := tx.Exec(ctx, statement, company.String(), actorUserID)
	return err
}

// endEveryWaitWithin: a message ansa waits to see whether you answer
// yourself is due now (core's catch-up runs every 15 seconds); one due
// already keeps its earlier time, and its place in the catch-up's order.
func endEveryWaitWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID) error {
	_, err := tx.Exec(ctx, `UPDATE conversations SET assistant_due_at = now() WHERE company_id = $1 AND assistant_due_at > now()`, company.String())
	return err
}
