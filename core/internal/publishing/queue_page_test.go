package publishing

import (
	"context"
	"slices"
	"testing"
	"time"
)

func shown(jobs []JobListItem) []string {
	var lines []string
	for _, job := range jobs {
		code := ""
		if job.LastError != nil {
			code = *job.LastError
		}
		lines = append(lines, job.ID+":"+job.Status+":"+code)
	}
	return lines
}

// The old publishing-page-checks.ts: the queue lists the company's posts by
// status with their counts, its rules and the current plan's pillars;
// members read it; another company's posts and activity never show.
func TestTheQueuePageShowsTheCompanysOwnPostsByStatus(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	page := w.page(t, "111")
	later := time.Now().Add(time.Hour)
	waiting := w.schedule(t, w.approvedPost(t, "Waiting"), []string{page}, &later)[0]
	canceled := w.schedule(t, w.approvedPost(t, "Canceled one"), []string{page}, &later)[0]
	CancelJob(ctx, w.pool, w.company, w.owner, canceled)
	other := newWorld(t)
	otherJob := other.schedule(t, other.approvedPost(t, "Theirs"), []string{other.page(t, "222")}, &later)[0]
	w.exec(t, `INSERT INTO marketing_plans (company_id, version, plan, facts_used, knowledge_used, used_support_trends, created_by_user_id)
		VALUES ($1, 1, '{"pillars": [{"name": "Lunch ideas"}, {"name": "Behind the oven"}, {"name": "Our people"}]}', '[]', '{}', false, $2)`, w.company.String(), w.owner)
	queue, err := ReadQueuePage(ctx, w.pool, w.company, false, time.Now())
	if err != nil {
		t.Fatalf("queue: %v", err)
	}
	if !slices.Equal(shown(queue.Waiting), []string{waiting + ":queued:"}) || !slices.Equal(shown(queue.Canceled), []string{canceled + ":canceled:"}) {
		t.Fatalf("lists: %v %v", shown(queue.Waiting), shown(queue.Canceled))
	}
	if queue.Counts["queued"] != 1 || queue.Counts["canceled"] != 1 || queue.CanManage || queue.IsBusy {
		t.Fatalf("counts %v, canManage %v, busy %v", queue.Counts, queue.CanManage, queue.IsBusy)
	}
	if !slices.Equal(queue.Pillars, []string{"Lunch ideas", "Behind the oven", "Our people"}) || queue.Waiting[0].CanceledByName != nil {
		t.Fatalf("pillars: %v", queue.Pillars)
	}
	for _, entry := range queue.Activity {
		if entry.JobID != nil && *entry.JobID == otherJob {
			t.Fatal("another company's activity shows")
		}
	}
	theirs, _ := ReadQueuePage(ctx, other.pool, other.company, true, time.Now())
	if !slices.Equal(shown(theirs.Waiting), []string{otherJob + ":queued:"}) || len(theirs.Canceled) != 0 || len(theirs.Pillars) != 0 {
		t.Fatalf("the other company's queue: %v", shown(theirs.Waiting))
	}
	// Due a moment ago (sent right after an answer): the page refreshes itself.
	w.makeDue(t, waiting)
	if queue, _ := ReadQueuePage(ctx, w.pool, w.company, true, time.Now()); !queue.IsBusy || !queue.CanManage {
		t.Fatal("a post just due keeps the page refreshing")
	}
}

// A post cut off while sending shows at once as needing attention on the
// queue (with its count) and the draft's page, keeps no page refreshing,
// though nothing was written; Mark as not published and Retry hand it to a
// person first, in their own transaction; one claimed a moment ago still
// shows as going out, and can't be marked.
func TestACutOffPostShowsAsNeedingAttentionAndAPersonHandsItOver(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	page := w.page(t, "333")
	var drafts, jobs []string
	for _, body := range []string{"Cut off", "Also cut off", "Claimed a moment ago"} {
		draftID := w.approvedPost(t, body)
		later := time.Now().Add(time.Hour)
		jobID := w.schedule(t, draftID, []string{page}, &later)[0]
		w.makeDue(t, jobID)
		if claim, _ := claimJob(ctx, w.pool, w.company, jobID, w.runner.claimable()); claim == nil {
			t.Fatal("not claimed")
		}
		drafts, jobs = append(drafts, draftID), append(jobs, jobID)
	}
	cutOff, alsoCutOff, fresh := jobs[0], jobs[1], jobs[2]
	w.exec(t, `UPDATE publish_jobs SET claimed_at = now() - interval '11 minutes' WHERE company_id = $1 AND id::text = ANY($2::text[])`, w.company.String(), jobs[:2])
	queue, _ := ReadQueuePage(ctx, w.pool, w.company, true, time.Now())
	attention := shown(queue.NeedsAttention)
	slices.Sort(attention)
	want := []string{cutOff + ":needs_attention:interrupted", alsoCutOff + ":needs_attention:interrupted"}
	slices.Sort(want)
	if !slices.Equal(attention, want) || !slices.Equal(shown(queue.Waiting), []string{fresh + ":publishing:"}) {
		t.Fatalf("queue: %v %v", attention, shown(queue.Waiting))
	}
	if queue.Counts["needs_attention"] != 2 || queue.Counts["publishing"] != 1 || !queue.IsBusy {
		t.Fatalf("counts %v, busy %v", queue.Counts, queue.IsBusy)
	}
	section, _ := ReadDraftPublishing(ctx, w.pool, w.company, drafts[0], true, time.Now())
	if !slices.Equal(shown(section.Jobs), []string{cutOff + ":needs_attention:interrupted"}) || section.IsBusy {
		t.Fatalf("draft page: %v %v", shown(section.Jobs), section.IsBusy)
	}
	if status, _, _ := w.jobState(t, cutOff); status != "publishing" || !slices.Equal(w.actionsOf(t, cutOff), []string{"scheduled"}) {
		t.Fatal("reading a page wrote something")
	}
	if outcome, _ := MarkJobNotPublished(ctx, w.pool, w.company, w.owner, cutOff); outcome != "changed" {
		t.Fatalf("mark not published: %s", outcome)
	}
	if status, code, _ := w.jobState(t, cutOff); status != "failed" || code != "interrupted" || w.draftStatus(t, drafts[0]) != "failed" {
		t.Fatalf("handed over, then failed: %s %s", status, code)
	}
	if got := w.actionsOf(t, cutOff); !slices.Equal(got, []string{"scheduled", "needs_attention:interrupted", "marked_not_published"}) {
		t.Fatalf("activity: %v", got)
	}
	if outcome, _ := RetryJob(ctx, w.pool, w.company, w.owner, alsoCutOff); outcome != "retried" {
		t.Fatalf("retry: %s", outcome)
	}
	if got := w.actionsOf(t, alsoCutOff); !slices.Equal(got, []string{"scheduled", "needs_attention:interrupted", "retried"}) {
		t.Fatalf("activity: %v", got)
	}
	if outcome, _ := MarkJobNotPublished(ctx, w.pool, w.company, w.owner, fresh); outcome != "wrong-status" {
		t.Fatalf("a post going out was marked: %s", outcome)
	}
	if status, _, _ := w.jobState(t, fresh); status != "publishing" || !slices.Equal(w.actionsOf(t, fresh), []string{"scheduled"}) {
		t.Fatal("a post going out was touched")
	}
}

// A draft's Publish section: its posts, the accounts of its platform (not
// a disconnected one, each saying whether the draft is live there), whether
// ansa publishes its format, the rule that would cover it, its own
// activity; another company's draft is not found.
func TestADraftsPublishSection(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	live, spare, gone := w.page(t, "444"), w.page(t, "445"), w.page(t, "446")
	w.exec(t, `UPDATE social_connections SET status = 'disconnected', access_token_encrypted = NULL, disconnected_at = now() WHERE company_id = $1 AND id = $2`, w.company.String(), gone)
	draftID := w.approvedPost(t, "Section")
	later := time.Now().Add(time.Hour)
	jobID := w.schedule(t, draftID, []string{live}, &later)[0]
	w.ruleOn(t)
	section, err := ReadDraftPublishing(ctx, w.pool, w.company, draftID, false, time.Now())
	if err != nil || section == nil {
		t.Fatalf("section: %v", err)
	}
	if len(section.Accounts) != 2 || !section.FormatPublishable || section.CoveringRule == nil || section.CanManage || section.IsBusy {
		t.Fatalf("section: %+v", section)
	}
	for _, account := range section.Accounts {
		if account.ID == gone || account.HasLiveJob != (account.ID == live) || (account.ID != live && account.ID != spare) {
			t.Fatalf("accounts: %+v", section.Accounts)
		}
	}
	if !slices.Equal(shown(section.Jobs), []string{jobID + ":queued:"}) || len(section.Activity) != 1 || *section.Activity[0].DraftID != draftID {
		t.Fatalf("jobs %v, activity %+v", shown(section.Jobs), section.Activity)
	}
	video := w.draft(t, "facebook", "video", "A video")
	if videoSection, _ := ReadDraftPublishing(ctx, w.pool, w.company, video, true, time.Now()); videoSection.FormatPublishable {
		t.Fatal("ansa doesn't publish Facebook videos yet")
	}
	other := newWorld(t)
	if theirs, err := ReadDraftPublishing(ctx, other.pool, other.company, draftID, true, time.Now()); theirs != nil || err != nil {
		t.Fatal("another company found the draft")
	}
}
