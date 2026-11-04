package settings

import (
	"context"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// Who set away_since (assistant_settings.away_set_by): a person ("I'm
// away" on Home or in the phone app), or the phones (none of them was
// reachable, core/internal/devices). A phone checking in again switches
// back only an away the phones set, never a person's own.
const (
	AwayByPerson = "person"
	AwayByPhone  = "phone"
)

// SetAway: "I'm away" (since now) or "I'm back", by an owner (read again).
// "I'm away" means ansa answers for you everywhere, in the same
// transaction: every conversation a person took over is handed back, and
// every message waiting out its minutes is answered at the catch-up's next
// round.
func SetAway(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, away bool) (string, error) {
	return AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		if away {
			return StartAwayWithin(ctx, tx, company, actorUserID, AwayByPerson)
		}
		return EndAwayWithin(ctx, tx, company, actorUserID)
	})
}

// StartAwayWithin is "I'm away" inside the caller's transaction (which took
// the company row lock first): away since now, set by setBy. actorUserID
// is the person who pressed it, or "" for the phones (the app itself: no
// person is named on its lines).
func StartAwayWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, actorUserID, setBy string) error {
	const upsert = `
		INSERT INTO assistant_settings (company_id, away_since, away_set_by, away_changed_at, updated_by_user_id)
		VALUES ($1, now(), $2, now(), NULLIF($3, ''))
		ON CONFLICT (company_id) DO UPDATE SET away_since = now(), away_set_by = $2, away_changed_at = now(),
			updated_by_user_id = COALESCE(NULLIF($3, ''), assistant_settings.updated_by_user_id), updated_at = now()`
	if _, err := tx.Exec(ctx, upsert, company.String(), setBy, actorUserID); err != nil {
		return err
	}
	if err := handBackEveryConversationWithin(ctx, tx, company, actorUserID); err != nil {
		return err
	}
	return endEveryWaitWithin(ctx, tx, company)
}

// EndAwayWithin is "I'm back" inside the caller's transaction: by a
// person, or "" for a phone checking in again.
func EndAwayWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, actorUserID string) error {
	const upsert = `
		INSERT INTO assistant_settings (company_id, away_since, away_set_by, away_changed_at, updated_by_user_id)
		VALUES ($1, NULL, NULL, now(), NULLIF($2, ''))
		ON CONFLICT (company_id) DO UPDATE SET away_since = NULL, away_set_by = NULL, away_changed_at = now(),
			updated_by_user_id = COALESCE(NULLIF($2, ''), assistant_settings.updated_by_user_id), updated_at = now()`
	_, err := tx.Exec(ctx, upsert, company.String(), actorUserID)
	return err
}

// handBackEveryConversationWithin: a reply in ansa takes a conversation
// over for good, so without this ansa would stay quiet there while you're
// away. Each one gets the line "Hand back" writes, by whoever pressed "I'm
// away" (no one when the phones switched it: ansa took it back itself).
func handBackEveryConversationWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, actorUserID string) error {
	const statement = `
		WITH handed_back AS (
			UPDATE conversations SET handled_by = 'assistant', taken_over_by_user_id = NULL, taken_over_at = NULL
			WHERE company_id = $1 AND handled_by = 'person'
			RETURNING id
		)
		INSERT INTO assistant_activity (company_id, conversation_id, action, actor_user_id)
		SELECT $1, id, 'handed_back', NULLIF($2, '') FROM handed_back`
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
