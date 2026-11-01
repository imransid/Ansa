package publishing

import (
	"context"
	"crypto/rand"
	"testing"
	"time"

	"ansa/core/internal/drafts"
)

// draft makes a draft of the world's company, as the AI wrote it (version 1).
func (w *world) draft(t *testing.T, platform, format, body string) string {
	t.Helper()
	request := drafts.NewDraft{Platform: platform, Format: format, Topic: "Topic of " + body, Body: body, Generated: true}
	id, err := drafts.Create(context.Background(), w.pool, w.company, w.owner, request)
	if err != nil {
		t.Fatalf("draft: %v", err)
	}
	return id
}

// approve: an owner approved the draft's current version (the content
// studio's Approve, which another part of core owns).
func (w *world) approve(t *testing.T, draftID, ownerID string) {
	t.Helper()
	w.exec(t, `UPDATE content_drafts SET status = 'approved', approved_by_user_id = $3, approved_at = now(), approved_version = version
		WHERE company_id = $1 AND id = $2`, w.company.String(), draftID, ownerID)
}

// approvedPost is an approved Facebook text post.
func (w *world) approvedPost(t *testing.T, body string) string {
	t.Helper()
	draftID := w.draft(t, "facebook", "post", body)
	w.approve(t, draftID, w.owner)
	return draftID
}

// schedule schedules a draft as the world's owner, as its current version
// (nil: now). It fails the test unless it was scheduled.
func (w *world) schedule(t *testing.T, draftID string, accounts []string, at *time.Time) []string {
	t.Helper()
	scheduled := w.tryToSchedule(t, w.owner, draftID, accounts, at, false)
	if scheduled.Outcome != "scheduled" {
		t.Fatalf("not scheduled: %+v", scheduled)
	}
	return scheduled.JobIDs
}

func (w *world) tryToSchedule(t *testing.T, actor, draftID string, accounts []string, at *time.Time, withoutApproval bool) Scheduled {
	t.Helper()
	var version int
	w.pool.QueryRow(context.Background(), `SELECT version FROM content_drafts WHERE company_id = $1 AND id = $2`, w.company.String(), draftID).Scan(&version)
	request := ScheduleRequest{DraftID: draftID, ShownVersion: version, ConnectionIDs: accounts, At: at, WithoutApproval: withoutApproval}
	scheduled, err := Schedule(context.Background(), w.pool, w.company, actor, request)
	if err != nil {
		t.Fatalf("schedule: %v", err)
	}
	return scheduled
}

// image stores an image in the media library: its row (the key made from
// the ids, as a CHECK wants) and its file.
func (w *world) image(t *testing.T, contentType, altText string, data []byte) string {
	t.Helper()
	ctx := context.Background()
	var id string
	w.pool.QueryRow(ctx, `SELECT gen_random_uuid()::text`).Scan(&id)
	extension := map[string]string{"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}[contentType]
	key := "media/" + w.company.String() + "/" + id + "." + extension
	w.exec(t, `INSERT INTO media_assets (id, company_id, kind, source, content_type, size_bytes, storage_key, original_name, alt_text, created_by_user_id)
		VALUES ($1, $2, 'image', 'upload', $3, $4, $5, 'photo', $6, $7)`, id, w.company.String(), contentType, len(data), key, altText, w.owner)
	if err := w.runner.Files.Put(ctx, key, data, contentType); err != nil {
		t.Fatalf("storing the image: %v", err)
	}
	return id
}

// imagePost is an approved Facebook post with this image attached.
func (w *world) imagePost(t *testing.T, body, assetID string) string {
	t.Helper()
	draftID := w.draft(t, "facebook", "image_post", body)
	w.exec(t, `UPDATE content_drafts SET media_asset_id = $3 WHERE company_id = $1 AND id = $2`, w.company.String(), draftID, assetID)
	w.approve(t, draftID, w.owner)
	return draftID
}

// makeDue makes a waiting post due now.
func (w *world) makeDue(t *testing.T, jobID string) {
	t.Helper()
	w.exec(t, `UPDATE publish_jobs SET run_after = now() - interval '1 second' WHERE company_id = $1 AND id = $2`, w.company.String(), jobID)
}

// runNow claims and sends one due post as the run after an answer does.
func (w *world) runNow(t *testing.T, jobID string) string {
	t.Helper()
	outcomes, err := w.runner.RunNow(context.Background(), w.company, []string{jobID})
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if len(outcomes) == 0 {
		return "not claimed"
	}
	return outcomes[0]
}

// actionsOf is one job's activity, oldest first, as "action" or "action:code".
func (w *world) actionsOf(t *testing.T, jobID string) []string {
	t.Helper()
	rows, err := w.pool.Query(context.Background(), `SELECT action || CASE WHEN code IS NULL THEN '' ELSE ':' || code END
		FROM cofounder_activity WHERE company_id = $1 AND job_id = $2 ORDER BY created_at, id`, w.company.String(), jobID)
	if err != nil {
		t.Fatalf("activity: %v", err)
	}
	defer rows.Close()
	var actions []string
	for rows.Next() {
		var action string
		rows.Scan(&action)
		actions = append(actions, action)
	}
	return actions
}

// field reads one column of one of the world's jobs as text ("" = NULL).
func (w *world) field(t *testing.T, jobID, column string) string {
	t.Helper()
	columns := map[string]string{"approved_version": "approved_version::text", "external_url": "external_url", "external_post_id": "external_post_id",
		"canceled_by_user_id": "canceled_by_user_id", "run_after_seconds": "round(extract(epoch FROM run_after - now()))::text"}
	var value *string
	w.pool.QueryRow(context.Background(), `SELECT `+columns[column]+` FROM publish_jobs WHERE company_id = $1 AND id = $2`, w.company.String(), jobID).Scan(&value)
	if value == nil {
		return ""
	}
	return *value
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
