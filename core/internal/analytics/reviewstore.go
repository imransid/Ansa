package analytics

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// One company's performance reviews (the old db/performance-reviews.ts):
// saving one an owner asked for, and reading the newest back. The marketing
// planner reads the same rows through its own code, so the columns keep the
// old JSON exactly (ReviewInput, Review).

// newestReview is one company's newest review as the page shows it (nil: none yet).
func newestReview(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (*ShownReview, error) {
	// company_id matched in the join too, so a name from another company can never show up.
	const statement = `
		SELECT reviews.period_start, reviews.period_end, reviews.input_summary, reviews.review, reviews.created_at, people.name
		FROM performance_reviews AS reviews
		LEFT JOIN users AS people ON people.company_id = reviews.company_id AND people.id = reviews.created_by_user_id
		WHERE reviews.company_id = $1
		ORDER BY reviews.created_at DESC, reviews.id DESC
		LIMIT 1`
	var shown ShownReview
	var inputJSON, reviewJSON []byte
	err := pool.QueryRow(ctx, statement, company.String()).Scan(&shown.PeriodStart, &shown.PeriodEnd, &inputJSON, &reviewJSON, &shown.MadeAt, &shown.MadeByName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return toShownReview(shown, inputJSON, reviewJSON), nil
}

// saveReview saves a review of one company made for actorUserID, while
// they are still an active owner: the role is read again, their row locked
// FOR SHARE, in the transaction that writes (a role change saved at that
// moment is waited for, then seen). False: not an owner any more. Every
// column named.
func saveReview(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, period Bounds, input ReviewInput, review Review) (bool, error) {
	inputJSON, err := json.Marshal(input)
	if err != nil {
		return false, err
	}
	reviewJSON, err := json.Marshal(review)
	if err != nil {
		return false, err
	}
	saved := false
	err = database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role != "owner" {
			return err
		}
		const insert = `
			INSERT INTO performance_reviews (company_id, period_start, period_end, input_summary, review, created_by_user_id)
			VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`
		if _, err := tx.Exec(ctx, insert, company.String(), period.Start, period.End, string(inputJSON), string(reviewJSON), actorUserID); err != nil {
			return err
		}
		saved = true
		return nil
	})
	return saved, err
}
