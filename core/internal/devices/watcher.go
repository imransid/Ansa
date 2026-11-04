package devices

import (
	"context"

	"ansa/core/internal/database"
	"ansa/core/internal/settings"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// At most this many companies are switched in one round (every 15 s).
const watcherBatch = 100

// The phones that count, of one company: connected, and paired by someone
// who is still a confirmed, active owner. Their newest sighting is the
// latest check-in, or the pairing for a phone that never checked in.
// (A fixed text, joined into the statements below, never input.)
const newestSighting = `
	SELECT max(COALESCE(devices.last_seen_at, devices.paired_at)) AS seen_at
	FROM devices
	JOIN users ON users.company_id = devices.company_id AND users.id = devices.paired_by_user_id
	WHERE devices.company_id = assistant_settings.company_id AND devices.removed_at IS NULL
		AND users.role = 'owner' AND users.email_verified = true AND users.deactivated_at IS NULL`

// phonesUnreachable is when the phones switch ansa away (with the owner
// following them and ansa not away already, said in each statement): at
// least one phone counts, none was seen within the minutes chosen, and one
// was seen since away was last switched (so a person's "I'm back" while
// their phone is off isn't undone at the next round).
const phonesUnreachable = `
	phones.seen_at IS NOT NULL
	AND phones.seen_at < now() - make_interval(mins => assistant_settings.phone_wait_minutes)
	AND (assistant_settings.away_changed_at IS NULL OR phones.seen_at >= assistant_settings.away_changed_at)`

// SwitchAwayWhenUnreachable is the presence watcher's round (core's
// scheduler, every 15 s): every company whose phones are all unreachable
// is switched to away, each in its own transaction. It returns how many.
func SwitchAwayWhenUnreachable(ctx context.Context, pool *database.Pool) (int, error) {
	companies, err := findUnreachableCompanies(ctx, pool)
	if err != nil {
		return 0, err
	}
	switched := 0
	for _, company := range companies {
		done, err := switchAwayIfUnreachable(ctx, pool, company)
		if err != nil {
			return switched, err
		}
		if done {
			switched++
		}
	}
	return switched, nil
}

// findUnreachableCompanies is the watcher's look across companies: ids only.
func findUnreachableCompanies(ctx context.Context, pool *database.Pool) ([]tenant.CompanyID, error) {
	statement := `
		-- cross-company: the presence watcher serves every company that follows its phones; company ids only, each then switched through company-scoped statements.
		SELECT assistant_settings.company_id FROM assistant_settings
		WHERE assistant_settings.follow_phone AND assistant_settings.away_since IS NULL
			AND EXISTS (SELECT 1 FROM (` + newestSighting + `) AS phones WHERE ` + phonesUnreachable + `)
		LIMIT $1`
	rows, err := pool.Query(ctx, statement, watcherBatch)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	companies := []tenant.CompanyID{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		company, err := tenant.FromTrustedSource(id)
		if err != nil {
			return nil, err
		}
		companies = append(companies, company)
	}
	return companies, rows.Err()
}

// switchAwayIfUnreachable switches one company to away, exactly as "I'm
// away" does (conversations handed back, waits ended) but set by the
// phones and by no person, with its line. The company row lock comes first
// and the condition is read again under it: two cores (or a check-in at
// that moment) run one after the other, and the second finds it changed.
func switchAwayIfUnreachable(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (bool, error) {
	switched := false
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		statement := `
			SELECT EXISTS (SELECT 1 FROM assistant_settings
				WHERE assistant_settings.company_id = $1 AND assistant_settings.follow_phone AND assistant_settings.away_since IS NULL
					AND EXISTS (SELECT 1 FROM (` + newestSighting + `) AS phones WHERE ` + phonesUnreachable + `))`
		var stillUnreachable bool
		if err := tx.QueryRow(ctx, statement, company.String()).Scan(&stillUnreachable); err != nil || !stillUnreachable {
			return err
		}
		if err := settings.StartAwayWithin(ctx, tx, company, "", settings.AwayByPhone); err != nil {
			return err
		}
		switched = true
		return recordChangeWithin(ctx, tx, company, changeAway, "")
	})
	return switched, err
}
