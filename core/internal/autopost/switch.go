package autopost

import (
	"context"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/packages"
	"ansa/core/internal/publishing"
	"ansa/core/internal/settings"
	"ansa/core/internal/tenant"
)

// Choices is the owner's one switch: on or off, how often, what time, and
// "automatic" (ansa posts by itself) or "ask_first" (each post waits for an
// owner's approval).
type Choices struct {
	Enabled                bool
	Frequency, Clock, Mode string
}

// Save saves the switch (owners: the company row lock, then their role read
// again). Switched on records who and when: it posts in their name. In
// Automatic it switches the company's Facebook "any pillar" auto-publish
// rule on in the owner's name (only an owner's explicit switch turns one
// on); otherwise that rule goes off. Switched off, the posts not out yet
// are taken back (archived: out of the queue; one already out stays).
// Returns "saved", "not-allowed", "no-time-zone" (it posts in the
// business's own time, so setup must have chosen one) or "not-in-package"
// (the company's package doesn't include posts this often, step 57).
func Save(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, c Choices) (string, error) {
	view, err := settings.Read(ctx, pool, company)
	if err != nil {
		return "", err
	}
	if c.Enabled && view.TimeZone == nil {
		return "no-time-zone", nil
	}
	if c.Enabled {
		pkg, err := packages.Of(ctx, pool, company, time.Now())
		if err != nil {
			return "", err
		}
		if !pkg.AllowsPosting(c.Frequency) {
			return "not-in-package", nil
		}
	}
	outcome, err := settings.AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		const update = `
			UPDATE assistant_settings SET autopost_enabled = $2, autopost_frequency = $3, autopost_time = $4, autopost_mode = $5,
				autopost_enabled_by_user_id = CASE WHEN $2 THEN $6::text END, autopost_enabled_at = CASE WHEN $2 THEN now() END,
				updated_by_user_id = $6, updated_at = now()
			WHERE company_id = $1`
		tag, err := tx.Exec(ctx, update, company.String(), c.Enabled, c.Frequency, c.Clock, c.Mode, actorUserID)
		if err != nil || tag.RowsAffected() == 1 || c.Enabled {
			return err
		}
		// Switched off before setup made the row: a row of its own.
		const insert = `
			INSERT INTO assistant_settings (company_id, autopost_enabled, autopost_frequency, autopost_time, autopost_mode, updated_by_user_id)
			VALUES ($1, false, $2, $3, $4, $5)`
		_, err = tx.Exec(ctx, insert, company.String(), c.Frequency, c.Clock, c.Mode, actorUserID)
		return err
	})
	if err != nil || outcome != settings.Saved {
		return outcome, err
	}
	if _, err := publishing.SetAnyPillarRule(ctx, pool, company, actorUserID, "facebook", c.Enabled && c.Mode == "automatic"); err != nil {
		return "", err
	}
	if !c.Enabled {
		return settings.Saved, takeBackUpcoming(ctx, pool, company, actorUserID)
	}
	return settings.Saved, nil
}

// takeBackUpcoming archives the posts not out yet and marks them
// "stopped"; one that went out meanwhile can't be archived and stays.
func takeBackUpcoming(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string) error {
	upcoming, err := upcomingPostingTimes(ctx, pool, company)
	if err != nil {
		return err
	}
	for _, slot := range upcoming {
		slotID, draftID := slot[0], slot[1]
		archived := true
		if draftID != "" {
			outcome, err := publishing.ArchiveDraft(ctx, pool, company, actorUserID, draftID)
			if err != nil {
				return err
			}
			archived = outcome == "changed" || outcome == "unchanged"
		}
		if archived {
			if err := finishPostingTime(ctx, pool, company, slotID, SlotSkipped, "", "stopped", Choice{}, 0); err != nil {
				return err
			}
		}
	}
	return nil
}

// Page is Settings → Posts for me.
type Page struct {
	Enabled   bool        `json:"enabled"`
	Frequency string      `json:"frequency"`
	Clock     string      `json:"time"`
	Mode      string      `json:"mode"`
	TimeZone  *string     `json:"timeZone"`
	Pages     []string    `json:"pages"`
	NextTimes []time.Time `json:"nextTimes"`
	Slots     []Slot      `json:"slots"`
}

// ReadPage reads the switch, the connected Pages by name, the next three
// posting times and the newest 20 planned posts with how each did.
func ReadPage(ctx context.Context, pool *database.Pool, company tenant.CompanyID, now time.Time) (Page, error) {
	page := Page{Frequency: FrequencyThreeAWeek, Clock: "11:00", Mode: "automatic", Pages: []string{}, NextTimes: []time.Time{}}
	const statement = `SELECT autopost_enabled, autopost_frequency, autopost_time, autopost_mode, time_zone FROM assistant_settings WHERE company_id = $1`
	err := pool.QueryRow(ctx, statement, company.String()).Scan(&page.Enabled, &page.Frequency, &page.Clock, &page.Mode, &page.TimeZone)
	if err != nil && ignoreNoRows(err) != nil {
		return Page{}, err
	}
	rows, err := pool.Query(ctx, `SELECT display_name FROM social_connections WHERE company_id = $1 AND platform = 'facebook' AND status = 'connected' ORDER BY connected_at`, company.String())
	if err != nil {
		return Page{}, err
	}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return Page{}, err
		}
		page.Pages = append(page.Pages, name)
	}
	if err := rows.Err(); err != nil {
		return Page{}, err
	}
	if page.Enabled && page.TimeZone != nil {
		if zone, err := time.LoadLocation(*page.TimeZone); err == nil {
			page.NextTimes = append(page.NextTimes, NextPostingTimes(page.Frequency, page.Clock, zone, now, 3)...)
		}
	}
	page.Slots, err = ListPostingTimes(ctx, pool, company, 20)
	return page, err
}

// PostNow writes one post for this moment ("Post one now", owners: for
// trying it out); the publishing queue sends it within seconds in
// Automatic. "not-on" when Post for me is off.
func (w *Writer) PostNow(ctx context.Context, company tenant.CompanyID, now time.Time) (WriteOutcome, error) {
	const statement = `
		SELECT autopost_frequency, autopost_time, autopost_mode, time_zone, autopost_enabled_by_user_id FROM assistant_settings
		WHERE company_id = $1 AND autopost_enabled AND time_zone IS NOT NULL AND autopost_enabled_by_user_id IS NOT NULL`
	c := Company{ID: company}
	err := w.Pool.QueryRow(ctx, statement, company.String()).Scan(&c.Frequency, &c.Clock, &c.Mode, &c.TimeZone, &c.EnabledByUserID)
	if err != nil {
		if ignoreNoRows(err) == nil {
			return WriteOutcome{Outcome: "not-on"}, nil
		}
		return WriteOutcome{}, err
	}
	// Now, to the millisecond: a moment of its own (planned ones are on the minute).
	return w.WritePostFor(ctx, c, now.Truncate(time.Millisecond))
}

// The most posts one round writes (each may take two AI answers).
const postsPerRound = 10

// RunDue is one round (the scheduler calls it): for every company with
// "Post for me" on, the next posting time within a day gets its post
// written now, once (claimed). onlyCompany: the tests keep to theirs.
func (w *Writer) RunDue(ctx context.Context, onlyCompany string, now time.Time) (int, error) {
	companies, err := ListCompaniesPostingForThem(ctx, w.Pool)
	if err != nil {
		return 0, err
	}
	written := 0
	for _, company := range companies {
		if written >= postsPerRound {
			break
		}
		if onlyCompany != "" && company.ID.String() != onlyCompany {
			continue
		}
		zone, err := time.LoadLocation(company.TimeZone)
		if err != nil {
			continue
		}
		postAt := PostingTimeToWrite(company.Frequency, company.Clock, zone, now)
		if postAt.IsZero() {
			continue
		}
		if taken, err := PostingTimeTaken(ctx, w.Pool, company.ID, postAt); err != nil || taken {
			if err != nil {
				return written, err
			}
			continue
		}
		outcome, err := w.WritePostFor(ctx, company, postAt)
		if err != nil {
			// One company's failure never stops the others' posts.
			w.Log.Error("post for me failed", logging.ErrorType(err))
			continue
		}
		if outcome.Outcome != "taken" {
			written++
		}
	}
	return written, nil
}
