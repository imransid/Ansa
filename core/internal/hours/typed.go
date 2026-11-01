package hours

import (
	"regexp"
	"sort"
	"time"
)

// RangesPerDay is how many times a day a week may hold.
const RangesPerDay = 2

var timePattern = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)

// ReadDay reads one day's times as typed (each "HH:MM" or empty) and says
// what is wrong with them, if anything (the old readDay, word for word). A
// closing time of 00:00 means midnight; hours past midnight belong to the
// next day.
func ReadDay(typed []Range) ([]Range, string) {
	ranges := []Range{}
	if len(typed) > RangesPerDay {
		return nil, "At most two times a day."
	}
	for _, r := range typed {
		if r.Opens == "" && r.Closes == "" {
			continue
		}
		if r.Opens == "" || r.Closes == "" {
			return nil, "Give both an opening and a closing time."
		}
		if !timePattern.MatchString(r.Opens) || !timePattern.MatchString(r.Closes) {
			return nil, "Write times as hours and minutes, like 18:30."
		}
		closes := r.Closes
		if closes == "00:00" {
			closes = "24:00"
		}
		if minutesOf(closes) <= minutesOf(r.Opens) {
			return nil, "Closing time must come after opening time (after midnight goes on the next day)."
		}
		ranges = append(ranges, Range{Opens: r.Opens, Closes: closes})
	}
	sort.Slice(ranges, func(i, j int) bool { return minutesOf(ranges[i].Opens) < minutesOf(ranges[j].Opens) })
	for i := 1; i < len(ranges); i++ {
		if minutesOf(ranges[i].Opens) < minutesOf(ranges[i-1].Closes) {
			return nil, "These times overlap."
		}
	}
	return ranges, ""
}

// ReadWeek reads every day; problems are by day key ("mon": "...").
func ReadWeek(typed map[string][]Range) (Week, map[string]string) {
	week := Week{}
	problems := map[string]string{}
	for _, day := range Weekdays {
		ranges, problem := ReadDay(typed[day.Key])
		if problem != "" {
			problems[day.Key] = problem
			continue
		}
		week[day.Key] = ranges
	}
	return week, problems
}

var zonePattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_+\-/]*$`)

// KnownTimeZone: an IANA name this server knows ("Europe/Rome").
func KnownTimeZone(name string) bool {
	if len(name) == 0 || len(name) > 64 || !zonePattern.MatchString(name) {
		return false
	}
	_, err := time.LoadLocation(name)
	return err == nil
}
