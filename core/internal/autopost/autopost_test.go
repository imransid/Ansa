package autopost

import (
	"testing"
	"time"

	"ansa/core/internal/assistant"
)

func liked(n float64) *float64 { return &n }

func TestTheBrainPicksASpecialDayOnceThenTheBestKind(t *testing.T) {
	in := BrainInput{BusinessType: "restaurant", Items: []string{"Margherita", "Tiramisù"}, Date: "2026-12-24", Weekday: "Thursday"}
	if choice := ChooseNextPost(in); choice.Kind != KindSpecialDay || choice.Topic != "Christmas Eve" {
		t.Fatalf("special day: %+v", choice)
	}
	in.History = []PastPost{{Kind: KindSpecialDay, SpecialDay: "Christmas Eve"}}
	if choice := ChooseNextPost(in); choice.Kind != KindSpotlight || choice.ItemName != "Margherita" {
		t.Fatalf("once only, then a food business spotlights first: %+v", choice)
	}
	in.Date = "2026-11-05"
	in.History = []PastPost{{Kind: KindSpotlight, ItemName: "Margherita"}}
	if choice := ChooseNextPost(in); choice.Kind != KindVisitUs || choice.Topic != "The weekend is coming: come and see us" {
		t.Fatalf("a spotlight just now weighs it down; Thursday favours a visit: %+v", choice)
	}
	in.History = []PastPost{{Kind: KindTip}, {Kind: KindVisitUs}, {Kind: KindQuestion}, {Kind: KindSpotlight, ItemName: "Margherita"}}
	if choice := ChooseNextPost(in); choice.ItemName != "Tiramisù" {
		t.Fatalf("the item spotlighted least recently: %+v", choice)
	}
	in.Skip = []string{KindSpotlight}
	if choice := ChooseNextPost(in); choice.Kind == KindSpotlight {
		t.Fatal("a skipped kind never comes back on the second try")
	}
	people := BrainInput{BusinessType: "salon", Weekday: "Monday", History: []PastPost{
		{Kind: KindQuestion, Engagement: liked(40)}, {Kind: KindBehindTheScenes, Engagement: liked(2)}, {Kind: KindVisitUs, Engagement: liked(2)}, {Kind: KindTip, Engagement: liked(2)},
	}}
	if choice := ChooseNextPost(people); choice.Kind != KindTip {
		t.Fatalf("no items: no spotlight; recent uses weigh more than likes: %+v", choice)
	}
}

func TestPostingTimesFollowTheBusinessClock(t *testing.T) {
	rome, _ := time.LoadLocation("Europe/Rome")
	monday := time.Date(2026, 11, 2, 12, 0, 0, 0, rome)
	times := NextPostingTimes(FrequencyThreeAWeek, "11:00", rome, monday, 3)
	if len(times) != 3 || times[0].In(rome).Weekday() != time.Wednesday || times[0].In(rome).Hour() != 11 || times[2].In(rome).Weekday() != time.Monday {
		t.Fatalf("Monday after 11:00: Wed, Fri, Mon: %v", times)
	}
	if !PostingTimeToWrite(FrequencyThreeAWeek, "11:00", rome, monday).IsZero() {
		t.Fatal("Wednesday is more than a day away: nothing to write yet")
	}
	tuesday := monday.Add(24 * time.Hour)
	if PostingTimeToWrite(FrequencyThreeAWeek, "11:00", rome, tuesday) != times[0] {
		t.Fatal("within a day: written now")
	}
	repeated := NextPostingTimes(FrequencyDaily, "02:30", rome, time.Date(2026, 10, 24, 12, 0, 0, 0, rome), 1)
	if repeated[0].UTC().Hour() != 0 {
		t.Fatalf("a repeated hour takes the first: %v", repeated[0].UTC())
	}
	skipped := NextPostingTimes(FrequencyDaily, "02:30", rome, time.Date(2026, 3, 28, 12, 0, 0, 0, rome), 1)
	if skipped[0].In(rome).Hour() != 3 {
		t.Fatalf("a skipped hour moves past the jump: %v", skipped[0].In(rome))
	}
}

func TestAPostWithAMadeUpOfferNeverGoesOut(t *testing.T) {
	data := CheckData{CheckData: assistant.CheckData{Currency: "EUR", MenuPrices: []int64{950}, OwnerTexts: []string{"10% off on Mondays."}}, WordsToAvoid: []string{"cheap"}}
	cases := map[string]bool{
		"Our Margherita is €9.50, come try it!": true,
		"Our Margherita is €7.50!":              false,
		"10% off on Mondays!":                   true,
		"20% off this week!":                    false,
		"Use our coupon at the till.":           false,
		"Cheap and cheerful pizza.":             false,
		"Book at https://other.example now.":    false,
	}
	for body, want := range cases {
		if got := CheckText(Post{Body: body}, data); got != want {
			t.Errorf("%q: got %v", body, got)
		}
	}
	if CheckText(Post{Body: "Hello", Hashtags: []string{"a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"}}, data) {
		t.Error("more than Facebook's 10 hashtags")
	}
}

// A Bangla post's prices and percentages are read in Bengali digits too
// (RE2's \d is 0-9 only): a made-up "৫০%" or "৳৩০০" never goes out.
func TestABanglaPostWithAMadeUpOfferNeverGoesOut(t *testing.T) {
	data := CheckData{CheckData: assistant.CheckData{Currency: "BDT", MenuPrices: []int64{45000}, OwnerTexts: []string{"সোমবারে ১০% ছাড়।"}}, WordsToAvoid: []string{}}
	cases := map[string]bool{
		"আমাদের কাচ্চি বিরিয়ানি মাত্র ৪৫০ টাকা!": true,
		"আমাদের কাচ্চি বিরিয়ানি মাত্র ৳৩০০!":     false,
		"সোমবারে ১০% ছাড়!":                       true,
		"সব খাবারে ৫০% ছাড়!":                     false,
	}
	for body, want := range cases {
		if got := CheckText(Post{Body: body}, data); got != want {
			t.Errorf("%q: got %v", body, got)
		}
	}
}
