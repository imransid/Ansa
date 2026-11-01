package analytics

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestEveryPlatformDefinesEveryNumber(t *testing.T) {
	for _, platform := range Platforms {
		if len(Definitions[platform]) != len(MetricColumns) {
			t.Fatalf("%s defines %d numbers", platform, len(Definitions[platform]))
		}
		for _, column := range MetricColumns {
			definition, known := Definitions[platform][column]
			if !known || len(definition.Definition) <= 10 || strings.Contains(definition.Definition, "\n") {
				t.Fatalf("%s %s has no one-line definition", platform, column)
			}
			if definition.Status != "not_offered" && (definition.Label == "" || definition.Field == "") {
				t.Fatalf("%s %s has no label or field", platform, column)
			}
			if definition.Status == "needs_permission" && definition.Permission == "" {
				t.Fatalf("%s %s names no permission", platform, column)
			}
		}
	}
	collected := map[string][]string{
		"linkedin": nil,
		"facebook": {"reactions", "comments", "shares"},
		"x":        {"views", "reactions", "comments", "shares", "clicks"},
		"youtube":  {"views", "reactions", "comments"},
	}
	for platform, want := range collected {
		if got := CollectedColumns(platform); !reflect.DeepEqual(got, want) {
			t.Fatalf("%s collects %v", platform, got)
		}
	}
	// The research's names, as the old spec's examples write them.
	if Definitions["facebook"]["views"].Field != "post_media_view" || Definitions["linkedin"]["views"].Field != "IMPRESSION" ||
		Definitions["x"]["views"].Field != "public_metrics.impression_count" {
		t.Fatal("the research's field names")
	}
	if MetricLabel("x", "views") != "Impressions" || MetricLabel("x", "reach") != "Reach" || PlatformOffers("x", "reach") || !PlatformOffers("linkedin", "views") {
		t.Fatal("labels and what a platform offers")
	}
}

func TestNumbersAreReadFor30DaysAndXsFor28(t *testing.T) {
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	day := 24 * time.Hour
	if ReadDays("x") != 28 || ReadDays("facebook") != 30 {
		t.Fatal("the read days")
	}
	if NumbersStillRead("x", now.Add(-29*day), now) || !NumbersStillRead("facebook", now.Add(-29*day), now) || NumbersStillRead("facebook", now.Add(-30*day), now) {
		t.Fatal("a post as old as 29 days: still read on Facebook, not on X")
	}
}

func shown(platform string, ago time.Duration, mutate func(*ShownPost)) ShownPost {
	now := time.Now()
	post := ShownPost{PublishedPost: PublishedPost{Platform: platform, PublishedAt: now.Add(-ago), HasPlatformID: true}}
	post.NumbersStillRead = NumbersStillRead(platform, post.PublishedAt, now)
	if mutate != nil {
		mutate(&post)
	}
	return post
}

func TestTheNotesNeverPromiseAReadPastThePlatformsDays(t *testing.T) {
	day := 24 * time.Hour
	timeout := "timeout"
	cases := map[string]string{
		WhyNoNumbers(shown("x", 45*day, nil)):                                                  "ansa reads X posts' numbers for 28 days after they go out, and read none for this one.",
		WhyNoNumbers(shown("x", 2*time.Hour, nil)):                                             "Not read yet: ansa reads a post's numbers about once a day, from an hour after it went out.",
		WhyNoNumbers(shown("linkedin", time.Hour, nil)):                                        "LinkedIn gives its post numbers only with a permission ansa doesn't have yet (see What the numbers mean below).",
		WhyNoNumbers(shown("x", time.Hour, func(p *ShownPost) { p.AccountIsStandIn = true })):  "A development stand-in's post: no platform has its numbers, so only simulated ones show.",
		WhyNoNumbers(shown("x", time.Hour, func(p *ShownPost) { p.HasPlatformID = false })):    "Marked as published by hand: ansa doesn't know the post's id on X, so its numbers can't be read.",
		LatestTryProblem(shown("x", 3*day, func(p *ShownPost) { p.MetricsError = &timeout })):  "X didn't answer properly when ansa asked. ansa tries again tomorrow.",
		LatestTryProblem(shown("x", 29*day, func(p *ShownPost) { p.MetricsError = &timeout })): "",
		describeMetricsError("from_a_later_version", "X"):                                      "The numbers couldn't be read (from_a_later_version).",
	}
	for got, want := range cases {
		if got != want {
			t.Fatalf("got %q, want %q", got, want)
		}
	}
}

func snapshotOf(source string, values map[string]int64) *LatestMetrics {
	latest := &LatestMetrics{Source: source, Values: map[string]*int64{}}
	for _, column := range MetricColumns {
		if value, has := values[column]; has {
			latest.Values[column] = &value
		} else {
			latest.Values[column] = nil
		}
	}
	return latest
}

func TestTotalsAddOnlyTheNumbersPostsHave(t *testing.T) {
	posts := []PublishedPost{
		{Platform: "x", Latest: snapshotOf("dev_simulated", map[string]int64{"views": 40, "reactions": 2})},
		{Platform: "linkedin", Latest: snapshotOf("dev_simulated", map[string]int64{"views": 150, "reactions": 6})},
		{Platform: "linkedin", Latest: snapshotOf("dev_simulated", map[string]int64{"views": 60, "comments": 1})},
		{Platform: "linkedin"},
	}
	totals := TotalsByPlatform(posts)
	if len(totals) != 2 || totals[0].Platform != "linkedin" || totals[1].Platform != "x" {
		t.Fatalf("one entry per platform, in the platforms' order: %+v", totals)
	}
	linkedIn, x := totals[0], totals[1]
	if linkedIn.Posts != 3 || linkedIn.PostsWithNumbers != 2 || !linkedIn.Simulated {
		t.Fatalf("LinkedIn: %+v", linkedIn)
	}
	if views := linkedIn.Metrics["views"]; views.Kind != "total" || *views.Value != 210 || *views.Posts != 2 {
		t.Fatalf("a post without the number adds nothing: %+v", views)
	}
	if shares := linkedIn.Metrics["shares"]; shares.Kind != "not_collected" || !strings.HasPrefix(shares.Permission, "r_member_postAnalytics") {
		t.Fatalf("LinkedIn's shares need a permission: %+v", shares)
	}
	if linkedIn.Metrics["video_views"].Kind != "not_offered" || x.Metrics["reach"].Kind != "not_offered" || x.Metrics["shares"].Kind != "no_numbers_yet" {
		t.Fatal("not available, never 0")
	}
}
