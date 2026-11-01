package publishing

import (
	"context"
	"crypto/rand"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/drafts"
	"ansa/core/internal/files"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/secure"
	"ansa/core/internal/social"
	"ansa/core/internal/tenant"
)

type world struct {
	pool    *database.Pool
	box     *secure.Box
	company tenant.CompanyID
	owner   string
	runner  *Runner
	posted  []string
	answer  PostResult
}

func newWorld(t *testing.T) *world {
	t.Helper()
	w := &world{pool: database.ForTest(t)}
	companyID := database.TestCompany(t, w.pool)
	w.company, _ = tenant.FromTrustedSource(companyID)
	// Better Auth's ids are 32 letters and digits, never uuids.
	w.owner = w.person(t, "owner")
	w.box, _ = secure.NewBox("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	w.answer = PostResult{Kind: "published", PostID: "1_2", URL: "https://www.facebook.com/1_2"}
	limiter := ratelimit.New(w.pool, "test-secret")
	t.Cleanup(func() {
		w.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = ANY($1)`,
			[]string{limiter.Key("publish-attempts", companyID), limiter.Key("publishing-changes", w.owner)})
	})
	w.runner = &Runner{Pool: w.pool, Box: w.box, Limiter: limiter, Log: logging.New(os.Stderr), Files: &files.Store{DevFolder: t.TempDir()},
		FacebookAppSecret: "app-secret", StandInsAllowed: true, StandInDir: t.TempDir(), After: func(work func()) { work() },
		PublishFacebook: func(_ context.Context, _, pageID, token string, post OutgoingPost) PostResult {
			sent := pageID + "|" + token + "|" + post.Text
			if post.Media != nil {
				sent += "|" + post.Media.ContentType + "|" + post.Media.AltText + "|" + strconv.Itoa(len(post.Media.Bytes))
			}
			w.posted = append(w.posted, sent)
			return w.answer
		}}
	return w
}

// person adds a confirmed teammate with an id as Better Auth makes them.
func (w *world) person(t *testing.T, role string) string {
	t.Helper()
	const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	id := make([]byte, 32)
	rand.Read(id)
	for i := range id {
		id[i] = alphabet[int(id[i])%len(alphabet)]
	}
	w.exec(t, `INSERT INTO users (id, company_id, role, name, email, email_verified) VALUES ($1, $2, $3::user_role, $4, $1 || '@core-test.example', true)`,
		string(id), w.company.String(), role, "Test "+role)
	return string(id)
}

func (w *world) exec(t *testing.T, statement string, args ...any) {
	t.Helper()
	if _, err := w.pool.Exec(context.Background(), statement, args...); err != nil {
		t.Fatalf("setup: %v", err)
	}
}

// page connects a Facebook Page (the stand-in's id makes it the stand-in).
func (w *world) page(t *testing.T, externalID string) string {
	t.Helper()
	var id string
	ctx := context.Background()
	const insert = `INSERT INTO social_connections (company_id, platform, external_account_id, display_name, account_kind, access_token_encrypted, connected_by_user_id, is_stand_in)
		VALUES ($1, 'facebook', $2, 'Page', 'page', 'placeholder', $3, $2 = 'dev:stand-in') RETURNING id`
	if err := w.pool.QueryRow(ctx, insert, w.company.String(), externalID, w.owner).Scan(&id); err != nil {
		t.Fatalf("page: %v", err)
	}
	token, _ := w.box.Encrypt("page-token", social.TokenContext(w.company, id, "access"))
	w.exec(t, `UPDATE social_connections SET access_token_encrypted = $3 WHERE company_id = $1 AND id = $2`, w.company.String(), id, token)
	return id
}

// ruleOn makes the Facebook "any pillar" rule, switched on by the owner.
func (w *world) ruleOn(t *testing.T) {
	w.exec(t, `INSERT INTO autopublish_rules (company_id, platform, pillar, enabled, created_by_user_id, enabled_by_user_id, enabled_at)
		VALUES ($1, 'facebook', '', true, $2, $2, now())`, w.company.String(), w.owner)
}

// scheduleNow writes the AI's draft and schedules it under the rule.
func (w *world) scheduleNow(t *testing.T, pageID, body string) (string, Scheduled) {
	t.Helper()
	ctx := context.Background()
	draftID, err := drafts.Create(ctx, w.pool, w.company, w.owner, drafts.NewDraft{Platform: "facebook", Format: "post", Topic: "Friday", Body: body, Hashtags: []string{"pizza"}, Generated: true})
	if err != nil {
		t.Fatalf("draft: %v", err)
	}
	scheduled, err := Schedule(ctx, w.pool, w.company, w.owner, ScheduleRequest{DraftID: draftID, ShownVersion: 1, ConnectionIDs: []string{pageID}, WithoutApproval: true})
	if err != nil {
		t.Fatalf("schedule: %v", err)
	}
	return draftID, scheduled
}

func (w *world) jobState(t *testing.T, jobID string) (status, lastError string, attempts int) {
	t.Helper()
	var code *string
	w.pool.QueryRow(context.Background(), `SELECT status, last_error, attempts FROM publish_jobs WHERE company_id = $1 AND id = $2`, w.company.String(), jobID).Scan(&status, &code, &attempts)
	if code != nil {
		lastError = *code
	}
	return status, lastError, attempts
}

func (w *world) draftStatus(t *testing.T, draftID string) string {
	var status string
	w.pool.QueryRow(context.Background(), `SELECT status FROM content_drafts WHERE company_id = $1 AND id = $2`, w.company.String(), draftID).Scan(&status)
	return status
}

func TestARulesPostGoesToTheStandInPageAndTheDraftFollows(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	pageID := w.page(t, StandInAccountID)
	_, refused := w.scheduleNow(t, pageID, "Pizza night!")
	if refused.Outcome != "no-rule" {
		t.Fatalf("without an enabled rule, an unapproved post never goes: %+v", refused)
	}
	w.ruleOn(t)
	draftID, scheduled := w.scheduleNow(t, pageID, "Pizza night!")
	if scheduled.Outcome != "scheduled" || scheduled.Mode != "auto_rule" || len(scheduled.JobIDs) != 1 || w.draftStatus(t, draftID) != "scheduled" {
		t.Fatalf("scheduled: %+v", scheduled)
	}
	if handled, err := w.runner.RunDue(ctx, w.company.String()); err != nil || handled != 1 {
		t.Fatalf("run: %d %v", handled, err)
	}
	if status, _, _ := w.jobState(t, scheduled.JobIDs[0]); status != "published" || w.draftStatus(t, draftID) != "published" {
		t.Fatalf("job %s, draft %s", status, w.draftStatus(t, draftID))
	}
	files, _ := filepath.Glob(filepath.Join(w.runner.StandInDir, "facebook", "*.json"))
	if len(files) != 1 || len(w.posted) != 0 {
		t.Fatalf("the stand-in writes a file and calls nobody: %v %v", files, w.posted)
	}
	var actions []string
	rows, _ := w.pool.Query(ctx, `SELECT action || ':' || COALESCE(code, '') FROM cofounder_activity WHERE company_id = $1 ORDER BY created_at`, w.company.String())
	for rows.Next() {
		var action string
		rows.Scan(&action)
		actions = append(actions, action)
	}
	if len(actions) != 2 || actions[0] != "scheduled:auto_rule" || actions[1] != "published:" {
		t.Fatalf("activity: %v", actions)
	}
	w.runner.StandInsAllowed = false
	_, again := w.scheduleNow(t, pageID, "Another one")
	w.runner.RunDue(ctx, w.company.String())
	if status, code, _ := w.jobState(t, again.JobIDs[0]); status != "failed" || code != "platform_not_set_up" {
		t.Fatalf("production refuses the stand-in: %s %s", status, code)
	}
}

func TestARealPageGetsTheTextAndPlatformAnswersAreKept(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	pageID := w.page(t, "424242")
	w.ruleOn(t)
	_, scheduled := w.scheduleNow(t, pageID, "Fresh bread")
	w.answer = PostResult{Kind: "not_created", Code: "rate_limited", RetryAfterSeconds: 120}
	w.runner.RunDue(ctx, w.company.String())
	if status, code, attempts := w.jobState(t, scheduled.JobIDs[0]); status != "queued" || code != "rate_limited" || attempts != 1 {
		t.Fatalf("slowed down: %s %s %d", status, code, attempts)
	}
	if len(w.posted) != 1 || w.posted[0] != "424242|page-token|Fresh bread\n\n#pizza" {
		t.Fatalf("sent: %v", w.posted)
	}
	if handled, _ := w.runner.RunDue(ctx, w.company.String()); handled != 0 {
		t.Fatal("not due again before its wait")
	}
	w.exec(t, `UPDATE publish_jobs SET run_after = now() WHERE company_id = $1`, w.company.String())
	w.answer = PostResult{Kind: "not_created", Code: "token_rejected"}
	w.runner.RunDue(ctx, w.company.String())
	var connection string
	w.pool.QueryRow(ctx, `SELECT status FROM social_connections WHERE company_id = $1 AND id = $2`, w.company.String(), pageID).Scan(&connection)
	if status, code, _ := w.jobState(t, scheduled.JobIDs[0]); status != "failed" || code != "token_rejected" || connection != "needs_reauth" {
		t.Fatalf("token refused: %s %s, page %s", status, code, connection)
	}
}

func TestADraftChangedAfterSchedulingIsNeverSent(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	pageID := w.page(t, "777")
	w.ruleOn(t)
	draftID, scheduled := w.scheduleNow(t, pageID, "Old text")
	w.exec(t, `UPDATE content_drafts SET body = 'New text', version = 2, status = 'draft' WHERE company_id = $1 AND id = $2`, w.company.String(), draftID)
	w.runner.RunDue(ctx, w.company.String())
	if status, code, _ := w.jobState(t, scheduled.JobIDs[0]); status != "failed" || code != "draft_changed" || len(w.posted) != 0 {
		t.Fatalf("changed: %s %s %v", status, code, w.posted)
	}
	w.exec(t, `UPDATE content_drafts SET body = 'New text', status = 'draft' WHERE company_id = $1 AND id = $2`, w.company.String(), draftID)
	w.exec(t, `INSERT INTO business_facts (company_id, topic, confirmed_value, confirmed_by_user_id, confirmed_at, confirmed_source) VALUES ($1, 'words_to_avoid', 'bread', $2, now(), 'owner')`, w.company.String(), w.owner)
	_, blocked := w.scheduleNow(t, pageID, "Our bread is warm")
	if blocked.Outcome != "blocked" {
		t.Fatalf("a word to avoid blocks: %+v", blocked)
	}
}

func TestACutOffPostGoesToAPersonNeverAgainByItself(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	pageID := w.page(t, "888")
	w.ruleOn(t)
	draftID, scheduled := w.scheduleNow(t, pageID, "Hello")
	w.exec(t, `UPDATE publish_jobs SET status = 'publishing', attempts = 1, claimed_at = now() - interval '11 minutes' WHERE company_id = $1`, w.company.String())
	w.runner.RunDue(ctx, w.company.String())
	if status, code, _ := w.jobState(t, scheduled.JobIDs[0]); status != "needs_attention" || code != "interrupted" || w.draftStatus(t, draftID) != "failed" || len(w.posted) != 0 {
		t.Fatalf("cut off: %s %s, draft %s", status, code, w.draftStatus(t, draftID))
	}
}

func TestTheNextTryWaitsLongerEachTime(t *testing.T) {
	if SecondsUntilNextTry(1, 0) != 60 || SecondsUntilNextTry(4, 0) != 480 || SecondsUntilNextTry(2, 5) != 30 || SecondsUntilNextTry(2, 999999) != 86400 {
		t.Fatal("1, 2, 4, 8 minutes; what the platform asked within 30 s and a day")
	}
	jobs := []JobOfDraft{{"a", "failed"}, {"a", "queued"}, {"b", "published"}}
	if DraftStatusFromJobs(jobs, false) != "scheduled" || DraftStatusFromJobs([]JobOfDraft{{"a", "failed"}, {"a", "published"}}, false) != "published" {
		t.Fatal("a failure replaced on its account doesn't count")
	}
	if DraftStatusFromJobs([]JobOfDraft{{"a", "canceled"}}, true) != "approved" {
		t.Fatal("all canceled: approved while its approval holds")
	}
}
