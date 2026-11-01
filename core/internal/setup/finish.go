package setup

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/settings"
	"ansa/core/internal/tenant"
)

// RecordConnectDone: "Your channels" saves nothing; moving past it counts.
func RecordConnectDone(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, reached int) (string, error) {
	return settings.AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		return recordProgressWithin(ctx, tx, company, reached)
	})
}

// Finish is "Open ansa": setup is finished once every step was saved.
// NotReady: a step is still missing.
func Finish(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string) (string, error) {
	finished := false
	outcome, err := settings.AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		const finish = `
			UPDATE companies SET setup_finished_at = COALESCE(setup_finished_at, now())
			WHERE id = $1 AND setup_progress >= CASE WHEN kind = 'personal' THEN $2::int ELSE $3::int END
			RETURNING id`
		var id string
		err := tx.QueryRow(ctx, finish, company.String(), SavedSteps("personal"), SavedSteps("business")).Scan(&id)
		finished = err == nil
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	})
	if err == nil && outcome == settings.Saved && !finished {
		return NotReady, nil
	}
	return outcome, err
}

// NotReady: Finish found a step still missing.
const NotReady = "not-ready"
