package publishing

import (
	"context"
	"slices"
	"strconv"
	"testing"
	"time"
)

// The old publishing-schedule-checks.ts: Cancel takes a waiting post out
// (owners only; one that went out can't be); Publish now sends a waiting
// post at once; another company's owner finds none of it.
func TestCancelAndPublishNowAreAnOwnersAndFindOnlyTheirCompanysPosts(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	member := w.person(t, "member")
	page := w.page(t, "424242")
	draftID := w.approvedPost(t, "Fresh bread")
	later := time.Now().Add(10 * time.Hour)
	jobID := w.schedule(t, draftID, []string{page}, &later)[0]
	if outcome, _ := CancelJob(ctx, w.pool, w.company, member, jobID); outcome != "not-allowed" {
		t.Fatalf("a member canceled: %s", outcome)
	}
	other := newWorld(t)
	for _, act := range []func() (string, error){
		func() (string, error) { return CancelJob(ctx, other.pool, other.company, other.owner, jobID) },
		func() (string, error) { return PublishJobNow(ctx, other.pool, other.company, other.owner, jobID) },
		func() (string, error) {
			return MarkJobPublished(ctx, other.pool, other.company, other.owner, jobID, "")
		},
		func() (string, error) { return RetryJob(ctx, other.pool, other.company, other.owner, jobID) },
	} {
		if outcome, err := act(); outcome != "not-found" || err != nil {
			t.Fatalf("another company's owner found the post: %s %v", outcome, err)
		}
	}
	if outcome, _ := CancelJob(ctx, w.pool, w.company, w.owner, jobID); outcome != "changed" {
		t.Fatalf("cancel: %s", outcome)
	}
	if status, _, _ := w.jobState(t, jobID); status != "canceled" || w.field(t, jobID, "canceled_by_user_id") != w.owner || w.draftStatus(t, draftID) != "approved" {
		t.Fatalf("canceled: %s, draft %s", status, w.draftStatus(t, draftID))
	}
	if outcome, _ := CancelJob(ctx, w.pool, w.company, w.owner, jobID); outcome != "wrong-status" {
		t.Fatalf("canceled twice: %s", outcome)
	}
	// A canceled post leaves room for a new one on that account.
	jobID = w.schedule(t, draftID, []string{page}, &later)[0]
	outcome, _ := PublishJobNow(ctx, w.pool, w.company, w.owner, jobID)
	if dueIn, _ := strconv.Atoi(w.field(t, jobID, "run_after_seconds")); outcome != "changed" || dueIn > 0 {
		t.Fatalf("publish now: %s, due in %d s", outcome, dueIn)
	}
	if outcome := w.runNow(t, jobID); outcome != "published" || w.draftStatus(t, draftID) != "published" || len(w.posted) != 1 {
		t.Fatalf("sent now: %s, draft %s, %v", outcome, w.draftStatus(t, draftID), w.posted)
	}
	if outcome, _ := CancelJob(ctx, w.pool, w.company, w.owner, jobID); outcome != "wrong-status" {
		t.Fatalf("a published post was canceled: %s", outcome)
	}
	if got := w.actionsOf(t, jobID); !slices.Equal(got, []string{"scheduled", "publish_now", "published"}) {
		t.Fatalf("activity: %v", got)
	}
}

// An unclear answer needs a person and is never tried again by itself;
// Mark as published keeps the address, Mark as not published fails it,
// and Retry then sends it, its tries counted from 1 again.
func TestAPostNeedingAttentionIsMarkedOrTriedAgainByAPerson(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	page := w.page(t, "777")
	first, second := w.approvedPost(t, "First"), w.approvedPost(t, "Second")
	firstJob := w.schedule(t, first, []string{page}, nil)[0]
	secondJob := w.schedule(t, second, []string{page}, nil)[0]
	w.answer = PostResult{Kind: "unclear", Code: "server_error"}
	if w.runNow(t, firstJob) != "needs_attention" || w.runNow(t, secondJob) != "needs_attention" || w.runNow(t, firstJob) != "not claimed" {
		t.Fatal("an unclear answer needs a person, and is never claimed again by itself")
	}
	address := "https://www.facebook.com/1_9"
	if outcome, _ := MarkJobPublished(ctx, w.pool, w.company, w.owner, firstJob, address); outcome != "changed" {
		t.Fatalf("mark published: %s", outcome)
	}
	status, code, _ := w.jobState(t, firstJob)
	if status != "published" || code != "server_error" || w.field(t, firstJob, "external_url") != address || w.field(t, firstJob, "external_post_id") != "" || w.draftStatus(t, first) != "published" {
		t.Fatalf("marked published: %s %s %s, draft %s", status, code, w.field(t, firstJob, "external_url"), w.draftStatus(t, first))
	}
	if outcome, _ := MarkJobNotPublished(ctx, w.pool, w.company, w.owner, secondJob); outcome != "changed" || w.draftStatus(t, second) != "failed" {
		t.Fatalf("mark not published: %s, draft %s", outcome, w.draftStatus(t, second))
	}
	w.answer = PostResult{Kind: "published", PostID: "1_10", URL: "https://www.facebook.com/1_10"}
	if outcome, _ := RetryJob(ctx, w.pool, w.company, w.owner, secondJob); outcome != "retried" {
		t.Fatalf("retry: %s", outcome)
	}
	if status, code, attempts := w.jobState(t, secondJob); status != "queued" || code != "" || attempts != 0 {
		t.Fatalf("back in the queue: %s %s %d", status, code, attempts)
	}
	if w.runNow(t, secondJob) != "published" || w.draftStatus(t, second) != "published" {
		t.Fatal("the retried post went out")
	}
	want := []string{"scheduled", "needs_attention:server_error", "marked_not_published", "retried", "published"}
	if got := w.actionsOf(t, secondJob); !slices.Equal(got, want) {
		t.Fatalf("activity: %v", got)
	}
	if outcome, _ := MarkJobPublished(ctx, w.pool, w.company, w.owner, secondJob, ""); outcome != "wrong-status" {
		t.Fatalf("marked twice: %s", outcome)
	}
}

// Retry is checked like a new schedule: a draft changed since needs
// approving again, then its CURRENT version is sent; a failed post whose
// account has the draft again since can't be tried again.
func TestARetryIsCheckedLikeANewScheduleAndSendsTheCurrentVersion(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	page := w.page(t, "555")
	draftID := w.approvedPost(t, "Before")
	jobID := w.schedule(t, draftID, []string{page}, nil)[0]
	w.answer = PostResult{Kind: "not_created", Code: "invalid_request"}
	if w.runNow(t, jobID) != "failed" {
		t.Fatal("refused by the platform: failed")
	}
	// The content studio's edit: a new version, its approval gone, a draft again.
	w.exec(t, `UPDATE content_drafts SET body = 'After', version = 2, status = 'draft', approved_by_user_id = NULL, approved_at = NULL, approved_version = NULL
		WHERE company_id = $1 AND id = $2`, w.company.String(), draftID)
	if outcome, _ := RetryJob(ctx, w.pool, w.company, w.owner, jobID); outcome != "not-approved" {
		t.Fatalf("a changed draft needs approving again: %s", outcome)
	}
	if outcome, _ := RetryJob(ctx, w.pool, w.company, w.person(t, "member"), jobID); outcome != "not-allowed" {
		t.Fatalf("a member retried: %s", outcome)
	}
	w.approve(t, draftID, w.owner)
	w.answer = PostResult{Kind: "published", PostID: "1_11"}
	if outcome, _ := RetryJob(ctx, w.pool, w.company, w.owner, jobID); outcome != "retried" || w.field(t, jobID, "approved_version") != "2" {
		t.Fatalf("retried as version 2: %s %s", outcome, w.field(t, jobID, "approved_version"))
	}
	if w.runNow(t, jobID) != "published" || w.posted[len(w.posted)-1] != "555|page-token|After" {
		t.Fatalf("the new version went out: %v", w.posted)
	}
	// A failed post, then the draft scheduled again on that account.
	failing := w.approvedPost(t, "Fails first")
	failed := w.schedule(t, failing, []string{page}, nil)[0]
	w.answer = PostResult{Kind: "not_created", Code: "duplicate"}
	w.runNow(t, failed)
	later := time.Now().Add(time.Hour)
	again := w.schedule(t, failing, []string{page}, &later)[0]
	section, _ := ReadDraftPublishing(ctx, w.pool, w.company, failing, true, time.Now())
	for _, job := range section.Jobs {
		if job.ID == failed && !job.ScheduledAgain || job.ID == again && job.ScheduledAgain {
			t.Fatalf("scheduled again: %+v", job)
		}
	}
	if outcome, _ := RetryJob(ctx, w.pool, w.company, w.owner, failed); outcome != "already-scheduled" || w.draftStatus(t, failing) != "scheduled" {
		t.Fatalf("a replaced failure retried: %s, draft %s", outcome, w.draftStatus(t, failing))
	}
}
