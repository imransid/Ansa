package calendar

import (
	"testing"
	"time"

	"ansa/core/internal/strategy"
)

func TestWallClockAroundClockChangesAndDays(t *testing.T) {
	rome, _ := time.LoadLocation("Europe/Rome")
	cases := map[string]string{
		"2026-03-29 02:30": "2026-03-29T01:30:00Z", // skipped: the moment after the jump, 03:30 local
		"2026-10-25 02:30": "2026-10-25T00:30:00Z", // repeated: the first of the two
		"2026-11-03 09:00": "2026-11-03T08:00:00Z",
	}
	for typed, want := range cases {
		at, ok := WallClock(typed[:10], typed[11:], rome)
		if !ok || at.UTC().Format(time.RFC3339) != want {
			t.Fatalf("%s: %v %v", typed, at.UTC(), ok)
		}
	}
	if _, ok := WallClock("2026-02-30", "09:00", rome); ok {
		t.Fatal("no such date")
	}
	if _, ok := WallClock("2026-11-03", "24:00", rome); ok {
		t.Fatal("no such time")
	}
	if AddDays("2026-12-31", 1) != "2027-01-01" || Weekday("2026-11-02") != "Monday" || LocalDate(time.Date(2026, 11, 2, 23, 30, 0, 0, time.UTC), rome) != "2026-11-03" {
		t.Fatal("days")
	}
}

func TestTargetsFollowTheCadenceWithinFortyIdeas(t *testing.T) {
	targets := PlanTargets([]strategy.Cadence{{Platform: "facebook", PostsPerWeek: 3}, {Platform: "youtube", PostsPerWeek: 0.2}})
	if len(targets) != 2 || targets[0].Posts != 6 || targets[1].Posts != 1 || targets[1].Formats[0] != "video" || len(targets[0].Formats) != 2 {
		t.Fatalf("targets: %+v", targets)
	}
	busy := PlanTargets([]strategy.Cadence{{Platform: "x", PostsPerWeek: 14}, {Platform: "linkedin", PostsPerWeek: 14}, {Platform: "facebook", PostsPerWeek: 1}})
	if busy[0].Posts+busy[1].Posts+busy[2].Posts != 40 || busy[2].Posts != 2 || busy[0].Posts != 19 || busy[1].Posts != 19 {
		t.Fatalf("the busiest gives way first: %+v", busy)
	}
}

func TestPostsAreKeptToWhatWasAsked(t *testing.T) {
	asked := Asked{
		Dates:         []string{"2026-11-02", "2026-11-03"},
		Targets:       []Target{{Platform: "facebook", Posts: 2, Formats: []string{"post", "image_post"}}, {Platform: "youtube", Posts: 1, Formats: []string{"video"}}},
		Pillars:       []string{"Bread"},
		Campaigns:     []string{"Autumn"},
		PlannedTopics: []string{"Planned already"},
	}
	posts := []Post{
		{Date: "2026-11-09", Time: "09:00", Platform: "facebook", Format: "post", Topic: "A day not planned"},
		{Date: "2026-11-02", Time: "09:00", Platform: "x", Format: "post", Topic: "No target"},
		{Date: "2026-11-02", Time: "09:00", Platform: "facebook", Format: "post", Topic: " \u200b "},
		{Date: "2026-11-02", Time: "09:00", Platform: "facebook", Format: "post", Topic: " planned ALREADY "},
		{Date: "2026-11-02", Time: "25:00", Platform: "facebook", Format: "video", Pillar: " bread ", Campaign: "Spring", Topic: "Rye\nbread"},
		{Date: "2026-11-03", Time: "18:30", Platform: "facebook", Format: "image_post", Pillar: "Cakes", Campaign: "AUTUMN", Topic: "rye bread"},
		{Date: "2026-11-03", Time: "18:30", Platform: "facebook", Format: "post", Topic: "Spelt"},
		{Date: "2026-11-03", Time: "18:30", Platform: "facebook", Format: "post", Topic: "Third on Facebook"},
		{Date: "2026-11-03", Time: "10:00", Platform: "youtube", Format: "post", Topic: "Oven tour"},
	}
	kept := KeepPosts(posts, asked)
	if len(kept) != 3 {
		t.Fatalf("kept: %+v", kept)
	}
	first := kept[0]
	if first.Topic != "Rye bread" || first.Time != "09:00" || first.Format != "post" || first.Pillar != "Bread" || first.Campaign != "" {
		t.Fatalf("an odd time, a format not taken, names as the plan spells them: %+v", first)
	}
	if kept[1].Topic != "Spelt" || kept[2].Format != "video" || kept[2].Platform != "youtube" {
		t.Fatalf("a repeat and a platform past its target drop: %+v", kept)
	}
}
