package devices

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/settings"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// What a phone's presence change records (phone_presence_changes.change).
const (
	changeAway = "away"
	changeBack = "back"
)

// CheckIn is the app's check-in, in ONE transaction that takes the company
// row lock first (as the watcher does, so the two never cross: a check-in
// and the watcher's switch run one after the other): the phone seen now,
// and, if the phones had switched ansa away, ansa back ("I'm back", by no
// person) with its line. A person's own "I'm away" is left as it is. It
// reports false when the phone was removed meanwhile.
func CheckIn(ctx context.Context, pool *database.Pool, device Device) (bool, error) {
	connected := false
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, device.Company); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `UPDATE devices SET last_seen_at = now() WHERE company_id = $1 AND id = $2 AND removed_at IS NULL`,
			device.Company.String(), device.ID)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		connected = true
		awayByPhone, err := awayByPhoneWithin(ctx, tx, device.Company)
		if err != nil || !awayByPhone {
			return err
		}
		if err := settings.EndAwayWithin(ctx, tx, device.Company, ""); err != nil {
			return err
		}
		return recordChangeWithin(ctx, tx, device.Company, changeBack, device.ID)
	})
	return connected, err
}

// awayByPhoneWithin: ansa is away because the phones switched it.
func awayByPhoneWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID) (bool, error) {
	const statement = `
		SELECT away_since IS NOT NULL AND away_set_by = 'phone' FROM assistant_settings WHERE company_id = $1`
	var byPhone bool
	err := tx.QueryRow(ctx, statement, company.String()).Scan(&byPhone)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return byPhone, err
}

// recordChangeWithin writes the line the phone's app and Home read: away
// (no phone), or back (the phone that checked in).
func recordChangeWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, change, deviceID string) error {
	const insert = `INSERT INTO phone_presence_changes (company_id, change, device_id) VALUES ($1, $2, NULLIF($3, '')::uuid)`
	_, err := tx.Exec(ctx, insert, company.String(), change, deviceID)
	return err
}

// Unpair removes the phone itself (the app's "Disconnect"): its token is
// refused from now on.
func Unpair(ctx context.Context, pool *database.Pool, device Device) error {
	_, err := pool.Exec(ctx, `UPDATE devices SET removed_at = now() WHERE company_id = $1 AND id = $2 AND removed_at IS NULL`,
		device.Company.String(), device.ID)
	return err
}
