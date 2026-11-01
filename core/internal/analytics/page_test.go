package analytics

import (
	"context"
	"reflect"
	"testing"
	"time"

	"ansa/core/internal/database"
)

func jobIDs(posts []ShownPost) []string {
	ids := []string{}
	for _, post := range posts {
		ids = append(ids, post.JobID)
	}
	return ids
}

func TestThePagesPostsTotalsAndPeriods(t *testing.T) {
	pool := database.ForTest(t)
	w := newWorld(t, pool)
	ctx := context.Background()
	linkedIn := w.post("linkedin", "LinkedIn numbers", "", "3 hours")
	w.numbers(linkedIn, "dev_simulated", "2 hours", map[string]int64{"views": 100, "reactions": 5})
	w.numbers(linkedIn, "dev_simulated", "1 hour", map[string]int64{"views": 150, "reactions": 6})
	xPost := w.post("x", "X numbers", "", "2 hours")
	w.numbers(xPost, "dev_simulated", "1 hour", map[string]int64{"views": 40, "reactions": 2})
	older := w.post("linkedin", "Ten days ago", "", "10 days")
	w.numbers(older, "dev_simulated", "9 days", map[string]int64{"views": 60, "comments": 1})
	noNumbers := w.post("linkedin", "No numbers", "", "1 hour")

	week, err := ReadPage(ctx, pool, w.company, true, "7", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if got := jobIDs(week.Posts); !reflect.DeepEqual(got, []string{noNumbers, xPost, linkedIn}) {
		t.Fatalf("newest first: %v", got)
	}
	if week.PostCount != 3 || week.PostsWithNumbers != 2 || week.PostsNeededForReview != 3 || *week.Posts[2].Latest.Values["views"] != 150 {
		t.Fatalf("the counts and the newest snapshot: %+v", week)
	}
	if week.PostsNeededText != "A review needs at least 5 posts with numbers in the period, and it has 2: 3 more are needed." {
		t.Fatalf("why no review yet: %q", week.PostsNeededText)
	}
	if week.Posts[0].WhyNoNumbers != "A development stand-in's post: no platform has its numbers, so only simulated ones show." || week.Posts[2].WhyNoNumbers != "" {
		t.Fatal("why a post has no numbers, only for one without")
	}
	linkedInTotals, xTotals := week.Totals[0], week.Totals[1]
	if linkedInTotals.Platform != "linkedin" || linkedInTotals.Posts != 2 || linkedInTotals.PostsWithNumbers != 1 || !linkedInTotals.Simulated {
		t.Fatalf("LinkedIn's totals: %+v", linkedInTotals)
	}
	if views := linkedInTotals.Metrics["views"]; *views.Value != 150 || *views.Posts != 1 || linkedInTotals.Metrics["comments"].Kind != "not_collected" ||
		linkedInTotals.Metrics["video_views"].Kind != "not_offered" {
		t.Fatalf("LinkedIn's numbers: %+v", linkedInTotals.Metrics)
	}
	if *xTotals.Metrics["views"].Value != 40 || xTotals.Metrics["reach"].Kind != "not_offered" || xTotals.Metrics["shares"].Kind != "no_numbers_yet" {
		t.Fatalf("X's numbers: %+v", xTotals.Metrics)
	}

	month, _ := ReadPage(ctx, pool, w.company, true, "30", time.Now())
	if got := jobIDs(month.Posts); !reflect.DeepEqual(got, []string{noNumbers, xPost, linkedIn, older}) {
		t.Fatalf("30 days: %v", got)
	}
	if views, comments := month.Totals[0].Metrics["views"], month.Totals[0].Metrics["comments"]; *views.Value != 210 || *views.Posts != 2 || *comments.Value != 1 {
		t.Fatalf("a post without a number adds nothing: %+v %+v", views, comments)
	}
	quarter, _ := ReadPage(ctx, pool, w.company, true, "90", time.Now())
	if !quarter.PeriodStart.Before(month.PeriodStart) || month.PeriodEnd.Sub(month.PeriodStart) != 30*24*time.Hour {
		t.Fatal("the periods")
	}
	for _, odd := range [][]string{{"365"}, {""}, {"7", "90"}, nil} {
		if ParsePeriod(odd) != "30" {
			t.Fatalf("%v is 30 days", odd)
		}
	}
}

func TestAnotherCompanysPostsNeverShowAndTheProblemsDo(t *testing.T) {
	pool := database.ForTest(t)
	w, other := newWorld(t, pool), newWorld(t, pool)
	ctx := context.Background()
	mine := w.post("linkedin", "Mine", "", "1 hour")
	w.numbers(mine, "dev_simulated", "1 minute", map[string]int64{"views": 7})
	theirs := other.post("linkedin", "Theirs", "", "1 hour")
	other.numbers(theirs, "dev_simulated", "1 minute", map[string]int64{"views": 900})
	other.job("x", "Their failure", "", "failed", "", false)
	myFailure := w.job("x", "My failure", "", "failed", "", false)
	cutOff := w.job("x", "Cut off", "", "publishing", "11 minutes", false)
	w.job("x", "Still sending", "", "publishing", "1 minute", false)

	// A minute on: the rows were changed by the database's clock a moment
	// ago, and the period ends at this one's "now".
	page, err := ReadPage(ctx, pool, w.company, false, "30", time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if got := jobIDs(page.Posts); !reflect.DeepEqual(got, []string{mine}) || len(page.Totals) != 1 || *page.Totals[0].Metrics["views"].Value != 7 {
		t.Fatalf("only the company's own: %v %+v", got, page.Totals)
	}
	if len(page.Problems) != 2 || page.Problems[0].ID != cutOff || page.Problems[0].Status != "needs_attention" || *page.Problems[0].LastError != "interrupted" ||
		page.Problems[1].ID != myFailure || *page.Problems[1].LastError != "invalid_request" || page.Problems[1].DraftTopic != "My failure" {
		t.Fatalf("the period's problems, a cut-off post as needing attention: %+v", page.Problems)
	}
	if page.Activity.LastSimulatedAt == nil || page.Activity.LastCollectedAt != nil || page.Review != nil || page.CanReview {
		t.Fatalf("the activity, no review, a member can't review: %+v", page.Activity)
	}
	if len(page.Definitions) != 4 || page.Definitions[2].Metrics[0].Label != "Impressions" || page.ReadDays["x"] != 28 {
		t.Fatal("what the numbers mean")
	}
}
