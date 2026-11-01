// Package calendar is the Co-Founder's calendar (the old
// services/calendar-planning.ts, db/content-calendar.ts, lib/calendar-plan/
// and the calendar half of services/publishing-pages.ts): "Plan the next 2
// weeks" (the brain proposes post ideas from the current marketing plan;
// each becomes a draft in status idea, planned for a day and a time in the
// owner's own time zone; nothing written, approved or scheduled), and the
// calendar page's read of posts and planned drafts.
package calendar

import "time"

// Times are stored in UTC; a planned idea's day and time are the owner's
// own (the browser names its time zone). The old lib/publishing/schedule-time.ts.

const dateLayout = "2006-01-02"

var weekdays = []string{"Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"}

// WallClock is the moment a local date ("2026-11-03") and time ("09:30")
// name in a time zone (ok false: no such date or time). Around a clock
// change: a time that happens twice (clocks going back) is the first of
// the two, and one that never happens (clocks jumping forward) is the
// moment it would have been, after the jump (02:30 on the night clocks go
// from 02:00 to 03:00 is 03:30), as browsers read such a time too. Ported
// exactly rather than left to Go's own choice, which Go doesn't promise.
func WallClock(date, clock string, zone *time.Location) (time.Time, bool) {
	naive, err := time.Parse(dateLayout+" 15:04", date+" "+clock)
	if err != nil {
		return time.Time{}, false
	}
	// The zone's offset a day before and a day after: they differ only around a clock change.
	_, offsetBefore := naive.Add(-24 * time.Hour).In(zone).Zone()
	_, offsetAfter := naive.Add(24 * time.Hour).In(zone).Zone()
	candidates := []time.Time{naive.Add(-time.Duration(offsetBefore) * time.Second), naive.Add(-time.Duration(offsetAfter) * time.Second)}
	typed := date + "T" + clock
	var earliest time.Time
	for _, candidate := range candidates {
		if candidate.In(zone).Format(dateLayout+"T15:04") == typed && (earliest.IsZero() || candidate.Before(earliest)) {
			earliest = candidate
		}
	}
	if earliest.IsZero() {
		return candidates[0], true
	}
	return earliest, true
}

// LocalDate is the date an instant falls on in a time zone.
func LocalDate(at time.Time, zone *time.Location) string {
	return at.In(zone).Format(dateLayout)
}

// AddDays is the date this many calendar days after another, whatever the clocks do.
func AddDays(date string, days int) string {
	day, err := time.Parse(dateLayout, date)
	if err != nil {
		return date
	}
	return day.AddDate(0, 0, days).Format(dateLayout)
}

// Weekday is "Monday" for a date ("" for no date).
func Weekday(date string) string {
	day, err := time.Parse(dateLayout, date)
	if err != nil {
		return ""
	}
	return weekdays[day.Weekday()]
}
