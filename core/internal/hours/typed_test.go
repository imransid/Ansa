package hours

import "testing"

func TestDaysAreReadAsTheOldFormReadThem(t *testing.T) {
	ranges, problem := ReadDay([]Range{{Opens: "18:00", Closes: "00:00"}, {Opens: "12:00", Closes: "15:00"}})
	if problem != "" || len(ranges) != 2 || ranges[0].Opens != "12:00" || ranges[1].Closes != "24:00" {
		t.Fatalf("sorted, midnight as 24:00: %v %q", ranges, problem)
	}
	cases := map[string][]Range{
		"Give both an opening and a closing time.":                                         {{Opens: "18:00"}},
		"Write times as hours and minutes, like 18:30.":                                    {{Opens: "6pm", Closes: "11pm"}},
		"Closing time must come after opening time (after midnight goes on the next day).": {{Opens: "18:00", Closes: "02:00"}},
		"These times overlap.":                                                             {{Opens: "12:00", Closes: "16:00"}, {Opens: "15:00", Closes: "20:00"}},
	}
	for want, typed := range cases {
		if _, got := ReadDay(typed); got != want {
			t.Errorf("%v: got %q", typed, got)
		}
	}
	if !KnownTimeZone("Europe/Rome") || KnownTimeZone("Mars/Base") || KnownTimeZone("../etc") {
		t.Error("time zones")
	}
}
