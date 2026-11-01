package teammates

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"ansa/core/internal/database"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
	"ansa/core/internal/tickets"
)

// At most this many active categories per company (the AI reads them all).
const activeCategoriesMax = 100

// errRefused undoes a transaction whose checks failed half-way.
var errRefused = errors.New("teammates: refused")

// CreateCategory adds a category (owners: the caller checks the role),
// unless its name is taken in any letter case or the company has 100 active
// ones (counted under the company row lock, so two at once take turns).
// "created", "name-taken" or "limit-reached".
func CreateCategory(ctx context.Context, pool *database.Pool, company tenant.CompanyID, name string) (string, error) {
	outcome := "created"
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		active, err := countActive(ctx, tx, company, "")
		if err != nil {
			return err
		}
		if active >= activeCategoriesMax {
			outcome = "limit-reached"
			return nil
		}
		tag, err := tx.Exec(ctx, `INSERT INTO categories (company_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, company.String(), name)
		if err == nil && tag.RowsAffected() == 0 {
			outcome = "name-taken"
		}
		return err
	})
	return outcome, err
}

// RenameCategory renames one category; requests follow it (ON UPDATE
// CASCADE). "renamed", "name-taken" or "not-found".
func RenameCategory(ctx context.Context, pool *database.Pool, company tenant.CompanyID, categoryID, name string) (string, error) {
	var takenBy string
	err := pool.QueryRow(ctx, `SELECT id FROM categories WHERE company_id = $1 AND lower(name) = lower($2) AND id::text <> $3 LIMIT 1`, company.String(), name, categoryID).Scan(&takenBy)
	if err == nil {
		return "name-taken", nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	tag, err := pool.Exec(ctx, `UPDATE categories SET name = $3 WHERE company_id = $1 AND id::text = $2`, company.String(), categoryID, name)
	var pgErr *pgconn.PgError
	switch {
	case errors.As(err, &pgErr) && pgErr.Code == "23505":
		// Someone took the name between the check above and this update.
		return "name-taken", nil
	case err != nil:
		return "", err
	case tag.RowsAffected() == 0:
		return "not-found", nil
	}
	return "renamed", nil
}

// SetCategoryArchived archives a category (never deleted) or restores it.
// Restoring routes the company's open, unassigned requests in it, in the
// same transaction. "changed", "limit-reached" or "not-found".
func SetCategoryArchived(ctx context.Context, pool *database.Pool, company tenant.CompanyID, categoryID string, archived bool) (string, error) {
	outcome := "changed"
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		if !archived {
			active, err := countActive(ctx, tx, company, categoryID)
			if err != nil {
				return err
			}
			if active >= activeCategoriesMax {
				outcome = "limit-reached"
				return nil
			}
		}
		const update = `UPDATE categories SET archived_at = CASE WHEN $3 THEN now() END WHERE company_id = $1 AND id::text = $2`
		tag, err := tx.Exec(ctx, update, company.String(), categoryID, archived)
		if err != nil || tag.RowsAffected() == 0 {
			if err == nil {
				outcome = "not-found"
			}
			return err
		}
		if archived {
			return nil
		}
		return tickets.RouteWaitingInCategoriesWithin(ctx, tx, company, []string{categoryID})
	})
	return outcome, err
}

// SaveCategoriesOf replaces the ACTIVE categories one person handles. They
// must be able to take requests (confirmed, not removed: their row locked
// "no key update", so a removal saved at that moment is waited for, then
// seen), and every category must be an active one of this company, checked
// inside the INSERT that links it (the categories locked FOR SHARE: a short
// count undoes everything). Links to archived categories stay (restoring
// one brings its experts back). Open, unassigned requests waiting in these
// categories are routed in the same transaction. False: nothing changed.
func SaveCategoriesOf(ctx context.Context, pool *database.Pool, company tenant.CompanyID, userID string, categoryIDs []string) (bool, error) {
	wanted := unique(categoryIDs)
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		var person string
		const lockPerson = `
			SELECT id FROM users WHERE company_id = $1 AND id::text = $2 AND email_verified AND deactivated_at IS NULL FOR NO KEY UPDATE`
		if err := tx.QueryRow(ctx, lockPerson, company.String(), userID).Scan(&person); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return errRefused
			}
			return err
		}
		const unlink = `
			DELETE FROM user_categories WHERE company_id = $1 AND user_id = $2
				AND category_id IN (SELECT id FROM categories WHERE company_id = $1 AND archived_at IS NULL)`
		if _, err := tx.Exec(ctx, unlink, company.String(), person); err != nil {
			return err
		}
		if len(wanted) == 0 {
			return nil
		}
		const link = `
			INSERT INTO user_categories (company_id, user_id, category_id)
			SELECT users.company_id, users.id, categories.id FROM users
			JOIN categories ON categories.company_id = users.company_id
			WHERE users.company_id = $1 AND users.id = $2 AND users.email_verified AND users.deactivated_at IS NULL
				AND categories.id::text = ANY($3::text[]) AND categories.archived_at IS NULL
			FOR SHARE OF categories
			ON CONFLICT DO NOTHING`
		tag, err := tx.Exec(ctx, link, company.String(), person, wanted)
		if err != nil {
			return err
		}
		if int(tag.RowsAffected()) != len(wanted) {
			// A category is unknown, archived or another company's: undo the unlink too.
			return errRefused
		}
		return tickets.RouteWaitingInCategoriesWithin(ctx, tx, company, wanted)
	})
	if errors.Is(err, errRefused) {
		return false, nil
	}
	return err == nil, err
}

// countActive counts the company's active categories, leaving out one
// (the one being restored, which may be active already).
func countActive(ctx context.Context, tx database.Tx, company tenant.CompanyID, except string) (int, error) {
	var active int
	err := tx.QueryRow(ctx, `SELECT count(*) FROM categories WHERE company_id = $1 AND archived_at IS NULL AND id::text <> $2`, company.String(), except).Scan(&active)
	return active, err
}

func unique(values []string) []string {
	seen := map[string]bool{}
	kept := []string{}
	for _, value := range values {
		if !seen[value] {
			seen[value] = true
			kept = append(kept, value)
		}
	}
	return kept
}
