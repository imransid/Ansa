// Package hours reads a business's weekly hours (opening hours, or a
// person's away hours) in its own time zone, as the old lib/opening-hours.ts:
// at most two times a day, "24:00" for a closing at midnight.
package hours

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"
)

// Range is one time a day: opens "18:00", closes "23:00" (or "24:00").
type Range struct {
	Opens  string `json:"opens"`
	Closes string `json:"closes"`
}

// Week is the seven days by their keys: mon, tue, ... sun.
type Week map[string][]Range

// Weekdays in order, with their labels.
var Weekdays = []struct{ Key, Label string }{
	{"mon", "Monday"}, {"tue", "Tuesday"}, {"wed", "Wednesday"}, {"thu", "Thursday"},
	{"fri", "Friday"}, {"sat", "Saturday"}, {"sun", "Sunday"},
}

// Parse reads stored hours (jsonb); ok is false for any other shape, which
// counts as "not given" (as the old isOpeningHours).
func Parse(raw []byte) (Week, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, false
	}
	var week Week
	if err := json.Unmarshal(raw, &week); err != nil {
		return nil, false
	}
	for _, day := range Weekdays {
		ranges, present := week[day.Key]
		if !present || len(ranges) > 2 {
			return nil, false
		}
	}
	return week, true
}

// DescribeDay is "12:00 to 15:00 and 18:00 to midnight", or "Closed".
func DescribeDay(ranges []Range) string {
	if len(ranges) == 0 {
		return "Closed"
	}
	parts := make([]string, 0, len(ranges))
	for _, r := range ranges {
		parts = append(parts, formatTime(r.Opens)+" to "+formatTime(r.Closes))
	}
	return strings.Join(parts, " and ")
}

// Now says, in the zone: open (and until when), or when it opens, or closed.
func Now(week Week, zone *time.Location, at time.Time) (open bool, text string) {
	local := at.In(zone)
	day := strings.ToLower(local.Weekday().String())[:3]
	minutes := local.Hour()*60 + local.Minute()
	today := week[day]
	if len(today) == 0 {
		return false, "Closed today"
	}
	for _, r := range today {
		if minutesOf(r.Opens) <= minutes && minutes < minutesOf(r.Closes) {
			return true, "Open until " + formatTime(r.Closes)
		}
	}
	for _, r := range today {
		if minutesOf(r.Opens) > minutes {
			return false, "Opens at " + formatTime(r.Opens)
		}
	}
	return false, "Closed now"
}

func formatTime(t string) string {
	if t == "24:00" {
		return "midnight"
	}
	return t
}

func minutesOf(t string) int {
	h, m, _ := strings.Cut(t, ":")
	hours, _ := strconv.Atoi(h)
	mins, _ := strconv.Atoi(m)
	return hours*60 + mins
}
