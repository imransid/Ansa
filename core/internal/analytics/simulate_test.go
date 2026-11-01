package analytics

import (
	"context"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/database"
)

func (w *world) snapshots(jobID string) int {
	var count int
	w.pool.QueryRow(context.Background(), `SELECT count(*) FROM post_metrics WHERE company_id = $1 AND publish_job_id = $2`, w.company.String(), jobID).Scan(&count)
	return count
}

func TestSimulatedNumbersOnlyForAStandInsPublishedPost(t *testing.T) {
	pool := database.ForTest(t)
	w := newWorld(t, pool)
	ctx := context.Background()
	jobID := w.post("linkedin", "Simulated", "", "1 hour")
	saved, refusal, err := SimulatePostMetrics(ctx, pool, strings.ToUpper(jobID), []string{"views=120", "reactions=8", "shares=0"}, true)
	if err != nil || refusal != "" || saved.Company != w.company || saved.Platform != "linkedin" {
		t.Fatalf("saved: %+v %q %v", saved, refusal, err)
	}
	var source string
	var views, reach, shares *int64
	pool.QueryRow(ctx, `SELECT source, views, reach, shares FROM post_metrics WHERE company_id = $1 AND publish_job_id = $2`, w.company.String(), jobID).Scan(&source, &views, &reach, &shares)
	if source != "dev_simulated" || *views != 120 || reach != nil || *shares != 0 {
		t.Fatal("the numbers given, the rest NULL, labeled simulated")
	}
	page, _ := ReadPage(ctx, pool, w.company, true, "30", time.Now())
	if page.Posts[0].Latest.Source != "dev_simulated" || !page.Totals[0].Simulated {
		t.Fatal("the page shows them as simulated")
	}
	real := w.job("x", "Real", "", "published", "2 hours", false)
	waiting := w.job("x", "Waiting", "", "failed", "", true)
	refusals := map[string]string{
		real:    "That post went to a real account: its numbers come from its platform only, never from a simulation.",
		waiting: "That post hasn't gone out, so it has no numbers yet.",
	}
	for id, want := range refusals {
		if _, refusal, _ := SimulatePostMetrics(ctx, pool, id, []string{"views=5"}, true); refusal != want || w.snapshots(id) != 0 {
			t.Fatalf("got %q, want %q", refusal, want)
		}
	}
}

func TestSimulatedNumbersRefuseWhatThePlatformOrTheCommandDoesntTake(t *testing.T) {
	pool := database.ForTest(t)
	w := newWorld(t, pool)
	ctx := context.Background()
	xPost := w.post("x", "X simulated", "", "1 hour")
	linkedInPost := w.post("linkedin", "LinkedIn simulated", "", "1 hour")
	cases := []struct {
		job  string
		args []string
		want string
	}{
		{xPost, []string{"views=10", "reach=4"}, "X gives no reach: leave it out."},
		{linkedInPost, []string{"video_views=4"}, "LinkedIn gives no video views: leave it out."},
		{xPost, []string{"likes=3"}, `"likes=3" isn't a number ansa keeps.`},
		{xPost, []string{"views=1", "views=2"}, "views is given twice."},
		{xPost, []string{"views=-1"}, "views must be a whole number from 0 to 2147483647."},
		{xPost, []string{"views=1.5"}, "views must be a whole number"},
		{xPost, []string{"views=99999999999"}, "views must be a whole number from 0 to 2147483647."},
		{xPost, []string{"views="}, "views must be a whole number"},
		{xPost, nil, "Give at least one number."},
		{"not-an-id", []string{"views=1"}, `"not-an-id" isn't a publish job id.`},
		{"00000000-0000-4000-8000-000000000000", []string{"views=1"}, "No post has that id."},
	}
	for _, c := range cases {
		if _, refusal, err := SimulatePostMetrics(ctx, pool, c.job, c.args, true); err != nil || !strings.HasPrefix(refusal, c.want) {
			t.Fatalf("%v: got %q, want %q", c.args, refusal, c.want)
		}
	}
	if _, refusal, _ := SimulatePostMetrics(ctx, pool, xPost, []string{"views=1"}, false); !strings.Contains(refusal, "development only") {
		t.Fatalf("production: %q", refusal)
	}
	if w.snapshots(xPost) != 0 || w.snapshots(linkedInPost) != 0 {
		t.Fatal("nothing is saved")
	}
}
