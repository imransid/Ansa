package publishing

import (
	"bytes"
	"context"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"ansa/core/internal/logging"
)

// The old publishing-claim-checks.ts: five runners at the same moment
// claim a due post once: one request to the platform, one try.
func TestFiveRunnersAtOnceSendAPostOnce(t *testing.T) {
	w := newWorld(t)
	page := w.page(t, "601")
	jobID := w.schedule(t, w.approvedPost(t, "Once"), []string{page}, nil)[0]
	var lock sync.Mutex
	requests := 0
	w.runner.PublishFacebook = func(context.Context, string, string, string, OutgoingPost) PostResult {
		lock.Lock()
		defer lock.Unlock()
		requests++
		return PostResult{Kind: "published", PostID: "1_601"}
	}
	var runs sync.WaitGroup
	for runner := range 5 {
		runs.Add(1)
		go func() {
			defer runs.Done()
			if runner < 3 {
				w.runner.RunNow(context.Background(), w.company, []string{jobID})
			} else {
				w.runner.RunDue(context.Background(), w.company.String())
			}
		}()
	}
	runs.Wait()
	if status, _, attempts := w.jobState(t, jobID); status != "published" || attempts != 1 || requests != 1 {
		t.Fatalf("sent %d times: %s, %d tries", requests, status, attempts)
	}
}

// A run that lost its post never writes over what came after: once its
// claim was handed to a person and the post tried again (its tries from 1
// again) and claimed anew, its writes change nothing and it can't read it.
func TestARunThatLostItsPostWritesNothing(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	page := w.page(t, "602")
	later := time.Now().Add(time.Hour)
	jobID := w.schedule(t, w.approvedPost(t, "Lost"), []string{page}, &later)[0]
	w.makeDue(t, jobID)
	lost, _ := claimJob(ctx, w.pool, w.company, jobID, w.runner.claimable())
	w.exec(t, `UPDATE publish_jobs SET claimed_at = now() - interval '11 minutes' WHERE company_id = $1 AND id = $2`, w.company.String(), jobID)
	if outcome, _ := RetryJob(ctx, w.pool, w.company, w.owner, jobID); outcome != "retried" {
		t.Fatalf("retry: %s", outcome)
	}
	current, _ := claimJob(ctx, w.pool, w.company, jobID, w.runner.claimable())
	if lost == nil || current == nil || current.Attempt != 1 || current.ClaimID == lost.ClaimID {
		t.Fatalf("claims: %+v %+v", lost, current)
	}
	written := []bool{}
	for _, write := range []func() (bool, error){
		func() (bool, error) {
			return recordPublished(ctx, w.pool, lost, PostResult{Kind: "published", PostID: "1_1"})
		},
		func() (bool, error) { return recordFailed(ctx, w.pool, lost, "network_error", "") },
		func() (bool, error) { return recordNeedsAttention(ctx, w.pool, lost, "server_error") },
		func() (bool, error) { return requeue(ctx, w.pool, lost, 60, "rate_limited", true) },
	} {
		done, err := write()
		written = append(written, done || err != nil)
	}
	snapshot, _ := readSnapshot(ctx, w.pool, lost)
	if slices.Contains(written, true) || snapshot != nil {
		t.Fatalf("the lost run wrote %v, read %v", written, snapshot != nil)
	}
	if status, _, _ := w.jobState(t, jobID); status != "publishing" {
		t.Fatalf("the current run's post: %s", status)
	}
}

// The platform is asked only while the claim is young enough for its
// slowest answer; a run held up past that sends nothing and puts the post
// back (run_too_slow, its try given back), and the next run sends it.
func TestARunTooSlowToSendPutsThePostBack(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	page := w.page(t, "603")
	later := time.Now().Add(time.Hour)
	jobID := w.schedule(t, w.approvedPost(t, "Slow"), []string{page}, &later)[0]
	w.makeDue(t, jobID)
	claim, _ := claimJob(ctx, w.pool, w.company, jobID, w.runner.claimable())
	w.exec(t, `UPDATE publish_jobs SET claimed_at = now() - interval '8 minutes' WHERE company_id = $1 AND id = $2`, w.company.String(), jobID)
	if outcome, _ := w.runner.send(ctx, claim); outcome != "requeued" || len(w.posted) != 0 {
		t.Fatalf("too slow: %s %v", outcome, w.posted)
	}
	if status, code, attempts := w.jobState(t, jobID); status != "queued" || code != "run_too_slow" || attempts != 0 {
		t.Fatalf("put back: %s %s %d", status, code, attempts)
	}
	if w.runNow(t, jobID) != "published" {
		t.Fatal("the next run sends it")
	}
}

// Past the company's posts for the day a post is held back (queued,
// daily_limit, its tries untouched, an hour later) and nobody is asked;
// another company still posts.
func TestTheDailyLimitHoldsAPostBack(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	jobID := w.schedule(t, w.approvedPost(t, "Held"), []string{w.page(t, "604")}, nil)[0]
	for range attemptsPerCompany.MaxAttempts {
		w.runner.Limiter.Over(ctx, "publish-attempts", w.company.String(), attemptsPerCompany)
	}
	if outcome := w.runNow(t, jobID); outcome != "held_back" || len(w.posted) != 0 {
		t.Fatalf("held back: %s %v", outcome, w.posted)
	}
	waits, _ := strconv.Atoi(w.field(t, jobID, "run_after_seconds"))
	if status, code, attempts := w.jobState(t, jobID); status != "queued" || code != "daily_limit" || attempts != 0 || waits < 3590 || waits > 3600 {
		t.Fatalf("held: %s %s %d, %d s", status, code, attempts, waits)
	}
	other := newWorld(t)
	otherJob := other.schedule(t, other.approvedPost(t, "Theirs"), []string{other.page(t, "605")}, nil)[0]
	if other.runNow(t, otherJob) != "published" {
		t.Fatal("another company still posts")
	}
}

// A platform's "slow down" puts the post back for the wait it asked (or
// 1, 2, 4, 8 minutes), each run a try, and the fifth fails it; the log
// says so with codes only, never the post or the token.
func TestFiveSlowDownsFailAPostAndTheLogHoldsNoPost(t *testing.T) {
	w := newWorld(t)
	var logged bytes.Buffer
	w.runner.Log = logging.New(&logged)
	jobID := w.schedule(t, w.approvedPost(t, "Secret sourdough recipe"), []string{w.page(t, "606")}, nil)[0]
	var waits []int
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		w.answer = PostResult{Kind: "not_created", Code: "rate_limited"}
		if attempt == 1 {
			w.answer.RetryAfterSeconds = 120
		}
		w.makeDue(t, jobID)
		outcome := w.runNow(t, jobID)
		wait, _ := strconv.Atoi(w.field(t, jobID, "run_after_seconds"))
		waits = append(waits, wait)
		if (attempt < maxAttempts) != (outcome == "requeued") {
			t.Fatalf("try %d: %s", attempt, outcome)
		}
	}
	if status, code, attempts := w.jobState(t, jobID); status != "failed" || code != "rate_limited" || attempts != maxAttempts {
		t.Fatalf("the fifth: %s %s %d", status, code, attempts)
	}
	for i, want := range []int{120, 120, 240, 480} {
		if waits[i] < want-3 || waits[i] > want {
			t.Fatalf("waits %v", waits)
		}
	}
	want := []string{"scheduled", "publish_delayed:rate_limited", "publish_delayed:rate_limited", "publish_delayed:rate_limited", "publish_delayed:rate_limited", "publish_failed:rate_limited"}
	if got := w.actionsOf(t, jobID); !slices.Equal(got, want) {
		t.Fatalf("activity: %v", got)
	}
	if strings.Contains(logged.String(), "sourdough") || strings.Contains(logged.String(), "page-token") || !strings.Contains(logged.String(), "rate_limited") {
		t.Fatalf("the log: %s", logged.String())
	}
}

// A run after an answer starts a post only while its slowest run still
// fits before its own end; the rest stay due for the scheduler.
func TestARunWithoutTimeLeftStartsNothing(t *testing.T) {
	w := newWorld(t)
	jobID := w.schedule(t, w.approvedPost(t, "Waits"), []string{w.page(t, "607")}, nil)[0]
	ctx, cancel := context.WithTimeout(context.Background(), longestSend-time.Second)
	defer cancel()
	if outcomes, _ := w.runner.RunNow(ctx, w.company, []string{jobID}); len(outcomes) != 0 {
		t.Fatalf("started: %v", outcomes)
	}
	if status, _, attempts := w.jobState(t, jobID); status != "queued" || attempts != 0 {
		t.Fatalf("left due: %s %d", status, attempts)
	}
}
