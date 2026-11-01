package api

import (
	"context"
	"io"
	"testing"
	"time"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/drafts"
	"ansa/core/internal/files"
	"ansa/core/internal/logging"
	"ansa/core/internal/publishing"
	"ansa/core/internal/session"
	"ansa/core/internal/social"
)

// queueWorld is apiWorld with a Facebook Page, a member's login and the
// publishing runner (a fake Facebook, sending right away).
type queueWorld struct {
	*apiWorld
	owner, page, memberCookie string
	answer                    publishing.PostResult
	sent                      int
}

func newQueueWorld(t *testing.T) *queueWorld {
	w := &queueWorld{apiWorld: newAPIWorld(t), answer: publishing.PostResult{Kind: "published", PostID: "1_2"}}
	ctx := context.Background()
	w.owner = w.ownerID()
	member := database.TestOwner(t, w.pool, w.company.String())
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1 AND id = $2`, w.company.String(), member)
	token, _ := conversations.NewID()
	w.must(`INSERT INTO sessions (id, token, expires_at, user_id) VALUES ($1, $1, now() + interval '1 day', $2)`, token, member)
	w.memberCookie = "better-auth.session_token=" + session.SignValue(token, authSecret)
	server := w.serverAPI()
	t.Cleanup(func() {
		w.pool.Exec(ctx, `DELETE FROM sessions WHERE token = $1`, token)
		keys := []string{server.Limiter.Key("publishing-changes", w.owner), server.Limiter.Key("publishing-changes", member), server.Limiter.Key("publish-attempts", w.company.String())}
		w.pool.Exec(ctx, `DELETE FROM rate_limits WHERE key = ANY($1)`, keys)
	})
	w.pool.QueryRow(ctx, `INSERT INTO social_connections (company_id, platform, external_account_id, display_name, account_kind, access_token_encrypted, connected_by_user_id)
		VALUES ($1, 'facebook', '4242', 'Bluebird', 'page', 'placeholder', $2) RETURNING id`, w.company.String(), w.owner).Scan(&w.page)
	encrypted, _ := server.Box.Encrypt("page-token", social.TokenContext(w.company, w.page, "access"))
	w.must(`UPDATE social_connections SET access_token_encrypted = $3 WHERE company_id = $1 AND id = $2`, w.company.String(), w.page, encrypted)
	server.Publisher = &publishing.Runner{Pool: w.pool, Box: server.Box, Limiter: server.Limiter, Log: logging.New(io.Discard),
		Files: &files.Store{DevFolder: t.TempDir()}, FacebookAppSecret: "app-secret", StandInDir: t.TempDir(), After: func(work func()) { work() },
		PublishFacebook: func(context.Context, string, string, string, publishing.OutgoingPost) publishing.PostResult {
			w.sent++
			return w.answer
		}}
	return w
}

// approvedDraft is an approved Facebook text post of the company.
func (w *queueWorld) approvedDraft(body string) string {
	id, err := drafts.Create(context.Background(), w.pool, w.company, w.owner, drafts.NewDraft{Platform: "facebook", Format: "post", Topic: body, Body: body, Generated: true})
	if err != nil {
		w.t.Fatalf("draft: %v", err)
	}
	w.must(`UPDATE content_drafts SET status = 'approved', approved_by_user_id = $3, approved_at = now(), approved_version = 1 WHERE company_id = $1 AND id = $2`, w.company.String(), id, w.owner)
	return id
}

func (w *queueWorld) jobStatus(jobID string) string {
	var status string
	w.pool.QueryRow(context.Background(), `SELECT status FROM publish_jobs WHERE company_id = $1 AND id = $2`, w.company.String(), jobID).Scan(&status)
	return status
}

// schedule schedules a draft as the owner; later: an hour from now.
func (w *queueWorld) schedule(draftID string, later bool) (int, map[string]any) {
	body := `{"version": 1, "connectionIds": ["` + w.page + `"], "when": "now", "withoutApproval": false}`
	if later {
		at := time.Now().Add(time.Hour).UTC().Format("2006-01-02T15:04:05.000Z")
		body = `{"version": 1, "connectionIds": ["` + w.page + `"], "when": "later", "scheduledFor": "` + at + `", "withoutApproval": false}`
	}
	return w.call("POST", "/api/v1/cofounder/publishing/drafts/"+draftID+"/schedule", body, screensSecret, w.cookie)
}

// The screens schedule a draft, and a post due now goes out right after
// the answer; the form's mistakes and a member are refused in the old
// pages' words; the Publish section and the queue show the posts.
func TestSchedulingThroughTheAPI(t *testing.T) {
	w := newQueueWorld(t)
	draftID := w.approvedDraft("Fresh bread")
	path := "/api/v1/cofounder/publishing/drafts/" + draftID + "/schedule"
	if code, answer := w.call("POST", path, `{"version": 1, "connectionIds": [], "when": "now"}`, screensSecret, w.cookie); code != 400 || answer["fields"].(map[string]any)["connectionIds"] != "Pick at least one account." {
		t.Fatalf("no account: %d %v", code, answer)
	}
	past := `{"version": 1, "connectionIds": ["` + w.page + `"], "when": "later", "scheduledFor": "2020-01-01T10:00:00.000Z"}`
	if code, answer := w.call("POST", path, past, screensSecret, w.cookie); code != 400 || answer["fields"].(map[string]any)["scheduledFor"] != "That time has passed: pick a later one, or Now." {
		t.Fatalf("a time passed: %d %v", code, answer)
	}
	now := `{"version": 1, "connectionIds": ["` + w.page + `"], "when": "now"}`
	if code, answer := w.call("POST", path, now, screensSecret, w.memberCookie); code != 403 || answer["error"] != onlyOwnersPublish {
		t.Fatalf("a member: %d %v", code, answer)
	}
	if code, answer := w.call("POST", path, `{"version": 2, "connectionIds": ["`+w.page+`"], "when": "now"}`, screensSecret, w.cookie); code != 409 || answer["error"] != scheduleRefusals["stale"] {
		t.Fatalf("an older page: %d %v", code, answer)
	}
	code, answer := w.schedule(draftID, false)
	jobIDs, _ := answer["jobIds"].([]any)
	if code != 200 || len(jobIDs) != 1 || w.sent != 1 || w.jobStatus(jobIDs[0].(string)) != "published" {
		t.Fatalf("scheduled for now went out: %d %v, sent %d", code, answer, w.sent)
	}
	if code, answer := w.schedule(draftID, false); code != 409 || answer["error"] != scheduleRefusals["already-scheduled"] {
		t.Fatalf("twice on one account: %d %v", code, answer)
	}
	code, section := w.call("GET", "/api/v1/cofounder/publishing/drafts/"+draftID, "", screensSecret, w.memberCookie)
	if jobs, _ := section["jobs"].([]any); code != 200 || len(jobs) != 1 || section["canManage"] != false || section["formatPublishable"] != true {
		t.Fatalf("the Publish section: %d %v", code, section)
	}
	code, queue := w.call("GET", "/api/v1/cofounder/queue", "", screensSecret, w.cookie)
	if counts, _ := queue["counts"].(map[string]any); code != 200 || counts["published"] != 1.0 || queue["canManage"] != true {
		t.Fatalf("the queue: %d %v", code, queue)
	}
	if code, _ := w.call("GET", "/api/v1/cofounder/publishing/drafts/"+w.page, "", screensSecret, w.cookie); code != 404 {
		t.Fatalf("not a draft of the company: %d", code)
	}
}

// Cancel, Publish now, Mark as published (only an address on the post's
// platform) and Retry through the API; another company's post (or none)
// isn't found.
func TestAnOwnersActionsOnPostsThroughTheAPI(t *testing.T) {
	w := newQueueWorld(t)
	jobOf := func(draftID string) string {
		_, answer := w.schedule(draftID, true)
		return answer["jobIds"].([]any)[0].(string)
	}
	action := func(jobID, name, body, cookie string) (int, map[string]any) {
		return w.call("POST", "/api/v1/cofounder/queue/jobs/"+jobID+"/"+name, body, screensSecret, cookie)
	}
	canceled := jobOf(w.approvedDraft("To cancel"))
	if code, _ := action(canceled, "cancel", "", w.memberCookie); code != 403 {
		t.Fatalf("a member canceled: %d", code)
	}
	if code, _ := action(canceled, "cancel", "", w.cookie); code != 200 || w.jobStatus(canceled) != "canceled" {
		t.Fatalf("cancel: %d", code)
	}
	if code, answer := action(canceled, "cancel", "{}", w.cookie); code != 409 || answer["error"] != changedMeanwhile["cancel"] {
		t.Fatalf("cancel twice: %d %v", code, answer)
	}
	w.answer = publishing.PostResult{Kind: "unclear", Code: "server_error"}
	unclear := jobOf(w.approvedDraft("To send now"))
	if code, _ := action(unclear, "publish-now", "", w.cookie); code != 200 || w.jobStatus(unclear) != "needs_attention" {
		t.Fatalf("publish now: %d %s", code, w.jobStatus(unclear))
	}
	if code, answer := action(unclear, "mark-published", `{"url": "https://x.com/ansa/status/1"}`, w.cookie); code != 400 ||
		answer["fields"].(map[string]any)["url"] != "Paste the post's address on Facebook (https://...), or leave it empty." {
		t.Fatalf("another platform's address: %d %v", code, answer)
	}
	if code, _ := action(unclear, "mark-published", `{"url": "https://www.facebook.com/4242_1"}`, w.cookie); code != 200 || w.jobStatus(unclear) != "published" {
		t.Fatalf("mark published: %d %s", code, w.jobStatus(unclear))
	}
	w.answer = publishing.PostResult{Kind: "not_created", Code: "duplicate"}
	failed := jobOf(w.approvedDraft("Refused first"))
	action(failed, "publish-now", "", w.cookie)
	w.answer = publishing.PostResult{Kind: "published", PostID: "1_3"}
	if code, answer := action(failed, "retry", "", w.cookie); code != 200 || answer["outcome"] != "retried" || w.jobStatus(failed) != "published" {
		t.Fatalf("retry: %d %v %s", code, answer, w.jobStatus(failed))
	}
	if code, answer := action(failed, "retry", "", w.cookie); code != 409 || answer["error"] != scheduleRefusals["not-retryable"] {
		t.Fatalf("a retry of a published post: %d %v", code, answer)
	}
	if code, answer := action(w.page, "cancel", "", w.cookie); code != 404 || answer["error"] != "We couldn't find that post. Reload the page." {
		t.Fatalf("no such post: %d %v", code, answer)
	}
	if code, _ := action(failed, "cancel", `{"companyId": "`+w.company.String()+`"}`, w.cookie); code != 400 {
		t.Fatalf("an unknown field: %d", code)
	}
}

// Rules through the API: a pillar must be the current plan's, a new rule
// is off, only an owner switches it.
func TestAutopublishRulesThroughTheAPI(t *testing.T) {
	w := newQueueWorld(t)
	if code, answer := w.call("POST", "/api/v1/cofounder/queue/rules", `{"platform": "facebook", "pillar": "Made up"}`, screensSecret, w.cookie); code != 400 ||
		answer["fields"].(map[string]any)["pillar"] != "Pick a content pillar of the current marketing plan, or any pillar." {
		t.Fatalf("a pillar of no plan: %d %v", code, answer)
	}
	code, answer := w.call("POST", "/api/v1/cofounder/queue/rules", `{"platform": "facebook", "pillar": ""}`, screensSecret, w.cookie)
	ruleID, _ := answer["ruleId"].(string)
	if code != 200 || ruleID == "" {
		t.Fatalf("made: %d %v", code, answer)
	}
	if code, answer := w.call("POST", "/api/v1/cofounder/queue/rules", `{"platform": "facebook", "pillar": ""}`, screensSecret, w.cookie); code != 409 {
		t.Fatalf("twice: %d %v", code, answer)
	}
	if code, _ := w.call("POST", "/api/v1/cofounder/queue/rules/"+ruleID, `{"enabled": true}`, screensSecret, w.memberCookie); code != 403 {
		t.Fatalf("a member switched it: %d", code)
	}
	if code, answer := w.call("POST", "/api/v1/cofounder/queue/rules/"+ruleID, `{"enabled": true}`, screensSecret, w.cookie); code != 200 || answer["outcome"] != "changed" {
		t.Fatalf("switched on: %d %v", code, answer)
	}
	_, queue := w.call("GET", "/api/v1/cofounder/queue", "", screensSecret, w.memberCookie)
	if rules, _ := queue["rules"].([]any); len(rules) != 1 || rules[0].(map[string]any)["enabled"] != true {
		t.Fatalf("the rules: %v", queue["rules"])
	}
}
