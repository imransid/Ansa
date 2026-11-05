package devices

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/settings"
	"ansa/core/internal/tenant"
)

// The website's page of connected phones (everyone reads it; owners change it).

// Page is the list of the company's connected phones and the setting.
type Page struct {
	Devices     []Listed `json:"devices"`
	FollowPhone bool     `json:"followPhone"`
	WaitMinutes int      `json:"waitMinutes"`
	CanChange   bool     `json:"canChange"`
	// Set while ansa is away because no phone was reachable (since when).
	PhoneAway *PhoneAway `json:"phoneAway"`
}

// Listed is one connected phone.
type Listed struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Platform   string `json:"platform"`
	PairedAt   string `json:"pairedAt"`
	LastSeenAt string `json:"lastSeenAt"`
	// Checked in within the wait (its pairing counts until its first
	// check-in), as the watcher counts it.
	Reachable bool `json:"reachable"`
}

// PhoneAway says since when the phones switched ansa away.
type PhoneAway struct {
	Since string `json:"since"`
}

// ReadPage reads the page: the phones newest first, the setting, and
// whether the phones switched ansa away.
func ReadPage(ctx context.Context, pool *database.Pool, company tenant.CompanyID, canChange bool) (Page, error) {
	page := Page{Devices: []Listed{}, WaitMinutes: defaultWaitMinutes, CanChange: canChange}
	var awaySince *time.Time
	const setting = `
		SELECT follow_phone, phone_wait_minutes, CASE WHEN away_set_by = 'phone' THEN away_since END
		FROM assistant_settings WHERE company_id = $1`
	err := pool.QueryRow(ctx, setting, company.String()).Scan(&page.FollowPhone, &page.WaitMinutes, &awaySince)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return page, err
	}
	if awaySince != nil {
		page.PhoneAway = &PhoneAway{Since: rfc3339(awaySince)}
	}
	const phones = `
		SELECT id, name, platform, paired_at, last_seen_at,
			COALESCE(last_seen_at, paired_at) >= now() - make_interval(mins => $2)
		FROM devices WHERE company_id = $1 AND removed_at IS NULL
		ORDER BY paired_at DESC`
	rows, err := pool.Query(ctx, phones, company.String(), page.WaitMinutes)
	if err != nil {
		return page, err
	}
	defer rows.Close()
	for rows.Next() {
		var phone Listed
		var pairedAt time.Time
		var lastSeenAt *time.Time
		if err := rows.Scan(&phone.ID, &phone.Name, &phone.Platform, &pairedAt, &lastSeenAt, &phone.Reachable); err != nil {
			return page, err
		}
		phone.PairedAt, phone.LastSeenAt = rfc3339(&pairedAt), rfc3339(lastSeenAt)
		page.Devices = append(page.Devices, phone)
	}
	return page, rows.Err()
}

// What removing a phone ends in (besides settings.NotAllowed).
const (
	Removed = "removed"
	// The phone was removed already (by the app, or another owner).
	Changed = "changed"
)

// Remove disconnects a phone (owners: the company row lock, the person read
// again): its token is refused from now on. The row stays, as history.
func Remove(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, deviceID string) (string, error) {
	removed := false
	outcome, err := settings.AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE devices SET removed_at = now() WHERE company_id = $1 AND id = $2 AND removed_at IS NULL`,
			company.String(), deviceID)
		removed = err == nil && tag.RowsAffected() == 1
		return err
	})
	switch {
	case err != nil || outcome != settings.Saved:
		return outcome, err
	case removed:
		return Removed, nil
	}
	return Changed, nil
}

// SaveSettings saves "Answer for me when my phone is unreachable for N
// minutes" (owners). Switching it off also ends an away the phones set:
// the phones no longer decide anything, so what they started stops with
// them (by this owner, as "I'm back").
func SaveSettings(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, followPhone bool, waitMinutes int) (string, error) {
	return settings.AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		const upsert = `
			INSERT INTO assistant_settings (company_id, follow_phone, phone_wait_minutes, updated_by_user_id) VALUES ($1, $2, $3, $4)
			ON CONFLICT (company_id) DO UPDATE SET follow_phone = $2, phone_wait_minutes = $3, updated_by_user_id = $4, updated_at = now()`
		if _, err := tx.Exec(ctx, upsert, company.String(), followPhone, waitMinutes, actorUserID); err != nil || followPhone {
			return err
		}
		awayByPhone, err := awayByPhoneWithin(ctx, tx, company)
		if err != nil || !awayByPhone {
			return err
		}
		return settings.EndAwayWithin(ctx, tx, company, actorUserID)
	})
}
