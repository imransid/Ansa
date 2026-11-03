package hours

import (
	"testing"
	"time"
)

const stored = `{"mon":[],"tue":[{"opens":"12:00","closes":"15:00"},{"opens":"18:00","closes":"24:00"}],"wed":[],"thu":[],"fri":[],"sat":[],"sun":[]}`

func TestHoursAreReadInTheBusinesssOwnZone(t *testing.T) {
	week, ok := Parse([]byte(stored))
	if !ok {
		t.Fatal("parse")
	}
	if DescribeDay(week["tue"]) != "12:00 to 15:00 and 18:00 to midnight" || DescribeDay(week["mon"]) != "Closed" {
		t.Fatalf("describe: %q", DescribeDay(week["tue"]))
	}
	rome, _ := time.LoadLocation("Europe/Rome")
	// Tuesday 2026-11-03 at 19:30 in Rome is 18:30 UTC.
	if open, text := Now(week, rome, time.Date(2026, 11, 3, 18, 30, 0, 0, time.UTC)); !open || text != "Open until midnight" {
		t.Fatalf("evening: %v %q", open, text)
	}
	if open, text := Now(week, rome, time.Date(2026, 11, 3, 15, 30, 0, 0, time.UTC)); open || text != "Opens at 18:00" {
		t.Fatalf("afternoon: %v %q", open, text)
	}
	if _, text := Now(week, rome, time.Date(2026, 11, 2, 12, 0, 0, 0, time.UTC)); text != "Closed today" {
		t.Fatalf("monday: %q", text)
	}
	if _, ok := Parse([]byte(`{"mon":[]}`)); ok {
		t.Fatal("a week missing days isn't hours")
	}
}

// A day open from 00:00 to midnight is "Open all day", at any hour.
func TestADayOpenAllDay(t *testing.T) {
	week := Week{"tue": {{Opens: "00:00", Closes: "24:00"}}}
	if DescribeDay(week["tue"]) != "Open all day" {
		t.Fatalf("described: %q", DescribeDay(week["tue"]))
	}
	for _, hour := range []int{0, 9, 23} {
		if open, text := Now(week, time.UTC, time.Date(2026, 11, 3, hour, 30, 0, 0, time.UTC)); !open || text != "Open all day" {
			t.Fatalf("%d:30: %v %q", hour, open, text)
		}
	}
}
