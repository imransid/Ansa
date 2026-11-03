package autopost

import (
	"context"
	"io"
	"testing"
	"time"

	"ansa/core/internal/files"
	"ansa/core/internal/logging"
	"ansa/core/internal/publishing"
	"ansa/core/internal/ratelimit"
)

// "Posts for me" waits (refreshing itself) while a post is due within the
// next minute or went due a moment ago and isn't out yet, and stops once it
// went out; a post's numbers say when they are simulated (development),
// as every other page does.
func TestThePageWaitsForAPostGoingOutAndMarksSimulatedNumbers(t *testing.T) {
	w := newPostWorld(t)
	ctx := context.Background()
	Save(ctx, w.pool, w.company, w.owner, Choices{Enabled: true, Frequency: FrequencyThreeAWeek, Clock: "11:00", Mode: "automatic"})
	w.answers = []string{`{"kind":"ok","body":"Come and see us this weekend.","call_to_action":"","hashtags":[]}`}
	now := time.Now()
	written, err := w.writer.PostNow(ctx, w.company, now)
	if err != nil || written.Outcome != SlotScheduled || len(written.JobIDs) != 1 {
		t.Fatalf("post one now: %+v %v", written, err)
	}
	busy := func(at time.Time) bool {
		t.Helper()
		page, err := ReadPage(ctx, w.pool, w.company, at)
		if err != nil {
			t.Fatalf("page: %v", err)
		}
		return page.IsBusy
	}
	if !busy(now.Add(5*time.Second)) || !busy(now.Add(-30*time.Second)) {
		t.Fatal("due now, or within the next minute: the page waits for it")
	}
	if busy(now.Add(-2*time.Minute)) || busy(now.Add(10*time.Minute)) {
		t.Fatal("due more than a minute ahead, or stuck for minutes: the page doesn't wait")
	}

	limiter := ratelimit.New(w.pool, "test-secret")
	t.Cleanup(func() {
		w.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, limiter.Key("publish-attempts", w.company.String()))
	})
	runner := &publishing.Runner{Pool: w.pool, Box: w.writer.Box, Limiter: limiter, Log: logging.New(io.Discard), Files: &files.Store{DevFolder: t.TempDir()},
		StandInsAllowed: true, StandInDir: t.TempDir()}
	if outcomes, err := runner.RunNow(ctx, w.company, written.JobIDs); err != nil || len(outcomes) != 1 {
		t.Fatalf("sent: %v %v", outcomes, err)
	}
	if busy(time.Now()) {
		t.Fatal("out: nothing to wait for")
	}
	const numbers = `INSERT INTO post_metrics (company_id, publish_job_id, collected_at, reactions, comments, source) VALUES ($1, $2, now(), 7, 2, 'dev_simulated')`
	if _, err := w.pool.Exec(ctx, numbers, w.company.String(), written.JobIDs[0]); err != nil {
		t.Fatalf("numbers: %v", err)
	}
	page, err := ReadPage(ctx, w.pool, w.company, time.Now())
	if err != nil || len(page.Slots) != 1 {
		t.Fatalf("page: %+v %v", page, err)
	}
	slot := page.Slots[0]
	if slot.DraftStatus == nil || *slot.DraftStatus != "published" || slot.Engagement == nil || *slot.Engagement != 9 || !slot.EngagementSimulated {
		t.Fatalf("posted, its simulated numbers said so: %+v", slot)
	}
}
