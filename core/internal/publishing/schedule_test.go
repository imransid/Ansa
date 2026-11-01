package publishing

import (
	"context"
	"slices"
	"sync"
	"testing"
	"time"
)

// The old publishing-activity-checks.ts and schedule checks: two schedules
// of one draft to one account at the same moment make one post (the second
// waits on the draft's row, then finds it there) and one "scheduled" row;
// a refused schedule writes nothing; another company's draft or account is
// never found.
func TestTwoSchedulesAtOnceMakeOnePostAndARefusalWritesNothing(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	page := w.page(t, "701")
	draftID := w.approvedPost(t, "Twice")
	later := time.Now().Add(time.Hour)
	first := w.tryToSchedule(t, w.owner, draftID, []string{page}, &later, false)
	request := ScheduleRequest{DraftID: draftID, ShownVersion: 2, ConnectionIDs: []string{page}, At: &later}
	if refused, _ := Schedule(ctx, w.pool, w.company, w.owner, request); refused.Outcome != "stale" || first.Outcome != "scheduled" {
		t.Fatalf("a page showing another version: %+v", refused)
	}
	CancelJob(ctx, w.pool, w.company, w.owner, first.JobIDs[0])
	before := len(w.scheduledRows(t, draftID))
	if before != 1 {
		t.Fatalf("the refused schedule wrote a row: %d", before)
	}
	outcomes := make([]string, 2)
	errs := make([]error, 2)
	var both sync.WaitGroup
	for i := range 2 {
		both.Add(1)
		go func() {
			defer both.Done()
			scheduled, err := Schedule(ctx, w.pool, w.company, w.owner, ScheduleRequest{DraftID: draftID, ShownVersion: 1, ConnectionIDs: []string{page}, At: &later})
			outcomes[i], errs[i] = scheduled.Outcome, err
		}()
	}
	both.Wait()
	slices.Sort(outcomes)
	if !slices.Equal(outcomes, []string{"already-scheduled", "scheduled"}) || errs[0] != nil || errs[1] != nil {
		t.Fatalf("at once: %v %v", outcomes, errs)
	}
	if rows := w.scheduledRows(t, draftID); len(rows) != before+1 {
		t.Fatalf("scheduled rows: %v", rows)
	}
	other := newWorld(t)
	theirPage := other.page(t, "702")
	if refused, _ := Schedule(ctx, other.pool, other.company, other.owner, ScheduleRequest{DraftID: draftID, ShownVersion: 1, ConnectionIDs: []string{theirPage}}); refused.Outcome != "not-found" {
		t.Fatalf("another company's draft: %+v", refused)
	}
	mine := w.approvedPost(t, "To their page")
	if refused := w.tryToSchedule(t, w.owner, mine, []string{theirPage}, &later, false); refused.Outcome != "account-not-connected" {
		t.Fatalf("another company's account: %+v", refused)
	}
	if refused := w.tryToSchedule(t, w.person(t, "member"), mine, []string{page}, &later, false); refused.Outcome != "not-allowed" {
		t.Fatalf("a member: %+v", refused)
	}
}

// scheduledRows are a draft's "scheduled" activity rows, by job.
func (w *world) scheduledRows(t *testing.T, draftID string) []string {
	t.Helper()
	rows, err := w.pool.Query(context.Background(), `SELECT job_id::text FROM cofounder_activity WHERE company_id = $1 AND draft_id = $2 AND action = 'scheduled'`, w.company.String(), draftID)
	if err != nil {
		t.Fatalf("activity: %v", err)
	}
	defer rows.Close()
	var jobs []string
	for rows.Next() {
		var job string
		rows.Scan(&job)
		jobs = append(jobs, job)
	}
	return jobs
}
