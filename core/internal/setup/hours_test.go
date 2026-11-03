package setup

import (
	"testing"

	"ansa/core/internal/hours"
)

// Opening hours with no time on any day would make ansa tell every customer
// the business is closed every day, so they are refused; away hours may be
// empty (the person answers themselves).
func TestOpeningHoursNeedATime(t *testing.T) {
	empty := Week{TimeZone: "Asia/Dhaka", Hours: map[string][]hours.Range{}}
	if _, fields := empty.Check(false); fields["hours"] == "" {
		t.Fatalf("empty opening hours accepted: %v", fields)
	}
	if _, fields := empty.Check(true); len(fields) != 0 {
		t.Fatalf("empty away hours refused: %v", fields)
	}
	oneDay := Week{TimeZone: "Asia/Dhaka", Hours: map[string][]hours.Range{"fri": {{Opens: "12:00", Closes: "22:00"}}}}
	if _, fields := oneDay.Check(false); len(fields) != 0 {
		t.Fatalf("one open day refused: %v", fields)
	}
}
