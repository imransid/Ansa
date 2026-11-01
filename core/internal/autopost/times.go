package autopost

import "time"

// How often and when ansa posts, in the business's own time zone.
const (
	FrequencyDaily      = "daily"
	FrequencyThreeAWeek = "three_a_week"
	FrequencyWeekly     = "weekly"
)

var postingDays = map[string]map[time.Weekday]bool{
	FrequencyDaily:      {time.Monday: true, time.Tuesday: true, time.Wednesday: true, time.Thursday: true, time.Friday: true, time.Saturday: true, time.Sunday: true},
	FrequencyThreeAWeek: {time.Monday: true, time.Wednesday: true, time.Friday: true},
	FrequencyWeekly:     {time.Friday: true},
}

// How far ahead ansa writes a post: a day, so the owner sees it coming
// (and can cancel it).
const writeAhead = 24 * time.Hour

// NextPostingTimes are the next posting moments after from, at the chosen
// local "HH:MM" on the posting days, looking at most 15 days ahead.
func NextPostingTimes(frequency, clock string, zone *time.Location, from time.Time, count int) []time.Time {
	hour, minute, ok := readClock(clock)
	days := postingDays[frequency]
	if !ok || days == nil {
		return nil
	}
	var times []time.Time
	local := from.In(zone)
	for day := 0; day < 15 && len(times) < count; day++ {
		date := time.Date(local.Year(), local.Month(), local.Day()+day, 12, 0, 0, 0, zone)
		if !days[date.Weekday()] {
			continue
		}
		at := wallClock(date.Year(), date.Month(), date.Day(), hour, minute, zone)
		if at.After(from) {
			times = append(times, at)
		}
	}
	return times
}

// PostingTimeToWrite is the next posting moment whose post ansa writes now
// (within the next day), or the zero time when none is that close.
func PostingTimeToWrite(frequency, clock string, zone *time.Location, now time.Time) time.Time {
	next := NextPostingTimes(frequency, clock, zone, now, 1)
	if len(next) == 0 || next[0].Sub(now) > writeAhead {
		return time.Time{}
	}
	return next[0]
}

// wallClock is the moment a local date and time names. A time a clock
// change skips moves past the jump (Go's own rule); a time it repeats
// takes the first of the two (Go picks the second).
func wallClock(year int, month time.Month, day, hour, minute int, zone *time.Location) time.Time {
	at := time.Date(year, month, day, hour, minute, 0, 0, zone)
	earlier := at.Add(-time.Hour).In(zone)
	if earlier.Hour() == hour && earlier.Minute() == minute && earlier.Day() == day {
		return earlier
	}
	return at
}

func readClock(clock string) (hour, minute int, ok bool) {
	parsed, err := time.Parse("15:04", clock)
	if err != nil {
		return 0, 0, false
	}
	return parsed.Hour(), parsed.Minute(), true
}
