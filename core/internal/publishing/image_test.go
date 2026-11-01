package publishing

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"ansa/core/internal/files"
)

type failingStorage struct{}

func (failingStorage) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("storage is down")
}

var testPNG = []byte("\x89PNG\r\n\x1a\nthe pixels")

// An approved Facebook post with an image goes out with the image's bytes,
// type and alt text, read from storage right before sending; the stand-in
// writes the image's kind, type, size and alt text, never the file.
func TestAnImagePostGoesOutWithItsImage(t *testing.T) {
	w := newWorld(t)
	asset := w.image(t, "image/png", "A loaf on a table", testPNG)
	page := w.page(t, "424242")
	jobID := w.schedule(t, w.imagePost(t, "Fresh bread", asset), []string{page}, nil)[0]
	if outcome := w.runNow(t, jobID); outcome != "published" || len(w.posted) != 1 || w.posted[0] != "424242|page-token|Fresh bread|image/png|A loaf on a table|18" {
		t.Fatalf("sent: %s %v", outcome, w.posted)
	}
	standIn := w.page(t, StandInAccountID)
	standInJob := w.schedule(t, w.imagePost(t, "On the stand-in", asset), []string{standIn}, nil)[0]
	if outcome := w.runNow(t, standInJob); outcome != "published" {
		t.Fatalf("stand-in: %s", outcome)
	}
	written, _ := filepath.Glob(filepath.Join(w.runner.StandInDir, "facebook", "*-"+standInJob+".json"))
	if len(written) != 1 {
		t.Fatalf("the stand-in's file: %v", written)
	}
	var record struct {
		Text  string         `json:"text"`
		Media map[string]any `json:"media"`
	}
	body, _ := os.ReadFile(written[0])
	json.Unmarshal(body, &record)
	if record.Text != "On the stand-in" || record.Media["kind"] != "image" || record.Media["content_type"] != "image/png" ||
		record.Media["size_bytes"] != 18.0 || record.Media["alt_text"] != "A loaf on a table" || len(record.Media) != 4 {
		t.Fatalf("the stand-in's record: %s", body)
	}
}

// The image gone from storage fails the post (media_missing); storage that
// doesn't answer puts it back in the queue, the try counted
// (media_unavailable). Nothing reaches the platform.
func TestAnImageStorageCantGiveStopsThePost(t *testing.T) {
	w := newWorld(t)
	ctx := context.Background()
	page := w.page(t, "424242")
	asset := w.image(t, "image/png", "", testPNG)
	missing := w.schedule(t, w.imagePost(t, "Missing", asset), []string{page}, nil)[0]
	var key string
	w.pool.QueryRow(ctx, `SELECT storage_key FROM media_assets WHERE company_id = $1 AND id = $2`, w.company.String(), asset).Scan(&key)
	w.runner.Files.Delete(ctx, key)
	if outcome := w.runNow(t, missing); outcome != "failed" {
		t.Fatalf("missing: %s", outcome)
	}
	if _, code, _ := w.jobState(t, missing); code != "media_missing" {
		t.Fatalf("missing: %s", code)
	}
	unavailable := w.schedule(t, w.imagePost(t, "Storage down", w.image(t, "image/png", "", testPNG)), []string{page}, nil)[0]
	w.runner.Files = &files.Store{R2: &files.R2{AccountID: "account", AccessKeyID: "key", SecretAccessKey: "secret", Bucket: "bucket"},
		Client: &http.Client{Transport: failingStorage{}}}
	if outcome := w.runNow(t, unavailable); outcome != "requeued" || len(w.posted) != 0 {
		t.Fatalf("storage down: %s %v", outcome, w.posted)
	}
	if status, code, attempts := w.jobState(t, unavailable); status != "queued" || code != "media_unavailable" || attempts != 1 {
		t.Fatalf("storage down: %s %s %d", status, code, attempts)
	}
}

// A post with an image is never scheduled without its image, nor with a
// word to avoid in the image's alt text (published with it).
func TestAnImagePostNeedsItsImageAndAltTextWithoutWordsToAvoid(t *testing.T) {
	w := newWorld(t)
	page := w.page(t, "424242")
	bare := w.draft(t, "facebook", "image_post", "No image yet")
	w.approve(t, bare, w.owner)
	if refused := w.tryToSchedule(t, w.owner, bare, []string{page}, nil, false); refused.Outcome != "blocked" {
		t.Fatalf("without its image: %+v", refused)
	}
	w.exec(t, `INSERT INTO business_facts (company_id, topic, confirmed_value, confirmed_by_user_id, confirmed_at, confirmed_source) VALUES ($1, 'words_to_avoid', 'cheap', $2, now(), 'owner')`,
		w.company.String(), w.owner)
	cheap := w.imagePost(t, "Fresh bread", w.image(t, "image/png", "Cheap bread", testPNG))
	if refused := w.tryToSchedule(t, w.owner, cheap, []string{page}, nil, false); refused.Outcome != "blocked" {
		t.Fatalf("a word to avoid in the alt text: %+v", refused)
	}
}
