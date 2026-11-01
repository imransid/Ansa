// Package settings changes how a company's assistant works
// (assistant_settings: one row per company), as the old
// db/assistant-settings.ts. Owners only: every write takes the company row
// lock first, then reads the person's role again (the old asRestaurantOwner),
// and names its columns (never a spread of what a form sent).
package settings

import (
	"context"

	"ansa/core/internal/database"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// What a write ended in.
const (
	Saved      = "saved"
	NotAllowed = "not-allowed"
)

// asOwner runs write inside one transaction while the person is a
// confirmed, active owner.
func asOwner(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, write func(tx database.Tx) error) (string, error) {
	outcome := Saved
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role != "owner" {
			outcome = NotAllowed
			return err
		}
		return write(tx)
	})
	return outcome, err
}

// SetStatus: "Pause ansa" ("paused") or "Turn ansa on" ("on").
func SetStatus(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, status string) (string, error) {
	return asOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		const upsert = `
			INSERT INTO assistant_settings (company_id, status, updated_by_user_id) VALUES ($1, $2, $3)
			ON CONFLICT (company_id) DO UPDATE SET status = $2, updated_by_user_id = $3, updated_at = now()`
		_, err := tx.Exec(ctx, upsert, company.String(), status, actorUserID)
		return err
	})
}

// SetAway: "I'm away" (since now) or "I'm back".
func SetAway(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, away bool) (string, error) {
	return asOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		const upsert = `
			INSERT INTO assistant_settings (company_id, away_since, updated_by_user_id) VALUES ($1, CASE WHEN $2 THEN now() END, $3)
			ON CONFLICT (company_id) DO UPDATE SET away_since = CASE WHEN $2 THEN now() END, updated_by_user_id = $3, updated_at = now()`
		_, err := tx.Exec(ctx, upsert, company.String(), away, actorUserID)
		return err
	})
}

// SetAnswerWhen: "always" or "when_away" (only when I'm away).
func SetAnswerWhen(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, answerWhen string) (string, error) {
	return asOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		const upsert = `
			INSERT INTO assistant_settings (company_id, answer_when, updated_by_user_id) VALUES ($1, $2, $3)
			ON CONFLICT (company_id) DO UPDATE SET answer_when = $2, updated_by_user_id = $3, updated_at = now()`
		_, err := tx.Exec(ctx, upsert, company.String(), answerWhen, actorUserID)
		return err
	})
}
