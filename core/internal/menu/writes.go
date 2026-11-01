package menu

import (
	"context"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// Add adds dishes at the end of the menu, in the order given: one typed in,
// or every dish of a checked reading. All or none, at most ItemsMax on the
// menu (counted under the company row lock).
func Add(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, items []Fields) (string, error) {
	outcome := Saved
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		if owner, err := ownerWithin(ctx, tx, company, actorUserID); err != nil || !owner {
			outcome = NotAllowed
			return err
		}
		var existing, last int
		if err := tx.QueryRow(ctx, `SELECT count(*), COALESCE(max(position), 0) FROM catalog_items WHERE company_id = $1`, company.String()).Scan(&existing, &last); err != nil {
			return err
		}
		if existing+len(items) > ItemsMax {
			outcome = TooMany
			return nil
		}
		const insert = `
			INSERT INTO catalog_items (company_id, category, name, description, price_cents, position, created_by_user_id, updated_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`
		for index, item := range items {
			if _, err := tx.Exec(ctx, insert, company.String(), item.Category, item.Name, item.Description, item.PriceCents, last+1+index, actorUserID); err != nil {
				return err
			}
		}
		return nil
	})
	return outcome, err
}

// Update changes one dish's category, name, description and price.
func Update(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, itemID string, f Fields) (string, error) {
	return ownersChange(ctx, pool, company, actorUserID, `
		UPDATE catalog_items SET category = $3, name = $4, description = $5, price_cents = $6, updated_by_user_id = $7, updated_at = now()
		WHERE company_id = $1 AND id = $2`, itemID, f.Category, f.Name, f.Description, f.PriceCents, actorUserID)
}

// Delete takes one dish off the menu for good.
func Delete(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, itemID string) (string, error) {
	return ownersChange(ctx, pool, company, actorUserID, `DELETE FROM catalog_items WHERE company_id = $1 AND id = $2`, itemID)
}

func ownersChange(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, statement, itemID string, more ...any) (string, error) {
	outcome := Saved
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if owner, err := ownerWithin(ctx, tx, company, actorUserID); err != nil || !owner {
			outcome = NotAllowed
			return err
		}
		tag, err := tx.Exec(ctx, statement, append([]any{company.String(), itemID}, more...)...)
		if err == nil && tag.RowsAffected() == 0 {
			outcome = NotFound
		}
		return err
	})
	return outcome, err
}

// SetAvailable: "Not available today" (until the business's midnight in its
// own zone; UTC before setup chose one), or available again. Anyone in the
// company: whoever is working knows first.
func SetAvailable(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, itemID string, available bool, now time.Time) (string, error) {
	outcome := Saved
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role == "" {
			outcome = NotAllowed
			return err
		}
		var until *time.Time
		if !available {
			zoneName := "UTC"
			err := tx.QueryRow(ctx, `SELECT COALESCE(time_zone, 'UTC') FROM assistant_settings WHERE company_id = $1`, company.String()).Scan(&zoneName)
			if ignoreNoRows(err) != nil {
				return err
			}
			zone, err := time.LoadLocation(zoneName)
			if err != nil {
				zone = time.UTC
			}
			end := EndOfLocalDay(zone, now)
			until = &end
		}
		tag, err := tx.Exec(ctx, `UPDATE catalog_items SET unavailable_until = $3, updated_by_user_id = $4, updated_at = now() WHERE company_id = $1 AND id = $2`,
			company.String(), itemID, until, actorUserID)
		if err == nil && tag.RowsAffected() == 0 {
			outcome = NotFound
		}
		return err
	})
	return outcome, err
}

// Move swaps one dish with the one before ("up") or after it in the same
// category; nothing to swap with changes nothing.
func Move(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, itemID, direction string) (string, error) {
	outcome := Saved
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		if owner, err := ownerWithin(ctx, tx, company, actorUserID); err != nil || !owner {
			outcome = NotAllowed
			return err
		}
		var category string
		var position int
		if err := tx.QueryRow(ctx, `SELECT category, position FROM catalog_items WHERE company_id = $1 AND id = $2`, company.String(), itemID).Scan(&category, &position); err != nil {
			outcome = NotFound
			return ignoreNoRows(err)
		}
		// One of two fixed statements, never input.
		neighbour := `SELECT id, position FROM catalog_items WHERE company_id = $1 AND category = $2 AND position > $3 ORDER BY position LIMIT 1`
		if direction == "up" {
			neighbour = `SELECT id, position FROM catalog_items WHERE company_id = $1 AND category = $2 AND position < $3 ORDER BY position DESC LIMIT 1`
		}
		var otherID string
		var otherPosition int
		if err := tx.QueryRow(ctx, neighbour, company.String(), category, position).Scan(&otherID, &otherPosition); err != nil {
			return ignoreNoRows(err)
		}
		const set = `UPDATE catalog_items SET position = $3 WHERE company_id = $1 AND id = $2`
		if _, err := tx.Exec(ctx, set, company.String(), itemID, otherPosition); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, set, company.String(), otherID, position)
		return err
	})
	return outcome, err
}
