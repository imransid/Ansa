package assistant

import (
	"strings"
	"time"

	"ansa/core/internal/hours"
)

// The hours behind GatherInputs: whether the business is closed now for
// orders, and "now" and the week as the brain reads them.

// closedNow is "Opens at 18:00" while the business is closed now by its own
// hours; "" while open, or when it gave no hours (nothing to go by).
func closedNow(takesOrders bool, s settingsRow, now time.Time) string {
	if !takesOrders || s.TimeZone == nil {
		return ""
	}
	week, ok := hours.Parse(s.OpeningHours)
	zone, err := time.LoadLocation(*s.TimeZone)
	if !ok || err != nil {
		return ""
	}
	if open, text := hours.Now(week, zone, now); !open {
		return text
	}
	return ""
}

// hoursFor is "now" and the week as the brain reads them: a business's
// opening hours, or a person's away hours and whether they said they're away.
func hoursFor(kind string, s settingsRow, now time.Time) *Hours {
	zoneName := "UTC"
	if s.TimeZone != nil {
		zoneName = *s.TimeZone
	}
	zone, err := time.LoadLocation(zoneName)
	if err != nil {
		return nil
	}
	local := now.In(zone).Format("Monday 15:04")
	if kind == "personal" {
		result := &Hours{TimeZone: zoneName, Now: local, Weekly: []string{}}
		if s.AwaySince != nil {
			result.Now += ", they said they are away"
		}
		if week, ok := hours.Parse(s.AwayHours); ok {
			for _, day := range hours.Weekdays {
				described := hours.DescribeDay(week[day.Key])
				if described == "Closed" {
					described = "no set hours"
				}
				result.Weekly = append(result.Weekly, "Away on "+day.Label+": "+described)
			}
		}
		return result
	}
	week, ok := hours.Parse(s.OpeningHours)
	if s.TimeZone == nil || !ok {
		return nil
	}
	_, text := hours.Now(week, zone, now)
	result := &Hours{TimeZone: zoneName, Now: local + ", " + strings.ToLower(text)}
	for _, day := range hours.Weekdays {
		result.Weekly = append(result.Weekly, day.Label+": "+hours.DescribeDay(week[day.Key]))
	}
	return result
}
