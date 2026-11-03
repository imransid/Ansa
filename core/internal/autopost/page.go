package autopost

import (
	"context"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// A post due within the next minute, or that went due this recently and
// isn't out yet, is about to go out (the run right after "Post one now",
// or the queue's next round): the page refreshes itself until it shows
// posted. One due longer ago waits for the queue's later rounds (held back,
// or the scheduler off), and the page doesn't wait with it, as the queue's
// own page doesn't (core/internal/publishing).
const (
	dueSoon = time.Minute
	justDue = 2 * time.Minute
)

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
	// A post is about to go out: the page refreshes itself.
	IsBusy bool `json:"isBusy"`
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
	if page.Slots, err = ListPostingTimes(ctx, pool, company, 20); err != nil {
		return Page{}, err
	}
	for _, slot := range page.Slots {
		if isAboutToGoOut(slot, now) {
			page.IsBusy = true
		}
	}
	return page, nil
}

// isAboutToGoOut: a scheduled post still on its way (its draft "scheduled":
// a post queued or being sent), due within the next minute or a moment ago.
func isAboutToGoOut(slot Slot, now time.Time) bool {
	onItsWay := slot.Status == SlotScheduled && slot.DraftStatus != nil && *slot.DraftStatus == "scheduled"
	return onItsWay && slot.PostAt.Before(now.Add(dueSoon)) && slot.PostAt.After(now.Add(-justDue))
}
