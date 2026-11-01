package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"image"
	"image/png"
	"io"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/files"
	"ansa/core/internal/logging"
	"ansa/core/internal/mediagen"
)

func TestTheMediaLibraryThroughCoresAPI(t *testing.T) {
	w := newAPIWorld(t)
	ctx := context.Background()
	var owner string
	w.pool.QueryRow(ctx, `SELECT id FROM users WHERE company_id = $1`, w.company.String()).Scan(&owner)
	t.Cleanup(func() {
		for _, key := range []string{w.api.Limiter.Key("media-uploads", owner), w.api.Limiter.Key("media-views", owner), w.api.Limiter.Key("media-changes", owner),
			w.api.Limiter.Key("content-draft-changes", owner), w.api.Limiter.Key("media-generations", w.company.String())} {
			w.pool.Exec(ctx, `DELETE FROM rate_limits WHERE key = $1`, key)
		}
	})
	store := &files.Store{DevFolder: t.TempDir()}
	w.api.Files = store
	w.api.Studio = &StudioServices{Generation: &mediagen.Service{Pool: w.pool, Files: store, Limiter: w.api.Limiter, Log: logging.New(io.Discard), Mode: mediagen.ModeFor("", false)}}
	var picture bytes.Buffer
	png.Encode(&picture, image.NewRGBA(image.Rect(0, 0, 4, 4)))
	upload := `{"fileName":"loaf.png","data":"` + base64.StdEncoding.EncodeToString(picture.Bytes()) + `","altText":"A loaf"}`
	code, answer := w.call("POST", "/api/v1/media", upload, screensSecret, w.cookie)
	assetID, _ := answer["assetId"].(string)
	if code != 200 || assetID == "" {
		t.Fatalf("uploaded: %d %v", code, answer)
	}
	if code, answer := w.call("POST", "/api/v1/media", strings.Replace(upload, "loaf.png", "loaf.jpg", 1), screensSecret, w.cookie); code != 400 || !strings.Contains(answer["error"].(string), "is a PNG image") {
		t.Fatalf("the name and the bytes must agree: %d %v", code, answer)
	}
	code, answer = w.call("GET", "/api/v1/media", "", screensSecret, w.cookie)
	if code != 200 || len(answer["assets"].([]any)) != 1 || answer["generation"].(map[string]any)["isStandIn"] != true {
		t.Fatalf("the library: %d %v", code, answer)
	}
	if code, answer := w.call("GET", "/api/v1/media/"+assetID+"/file", "", screensSecret, w.cookie); code != 200 || answer["contentType"] != "image/png" {
		t.Fatalf("the file with the type stored: %d", code)
	}
	tooLong := `{"altText":"` + strings.Repeat("a", 1_001) + `"}`
	if code, answer := w.call("POST", "/api/v1/media/"+assetID+"/alt-text", tooLong, screensSecret, w.cookie); code != 400 || answer["fields"] == nil {
		t.Fatalf("alt text of 1,001 is refused: %d", code)
	}
	code, answer = w.call("POST", "/api/v1/media/generations", `{"kind":"image","prompt":"A loaf"}`, screensSecret, w.cookie)
	jobID, _ := answer["jobId"].(string)
	if code != 200 || jobID == "" {
		t.Fatalf("asked: %d %v", code, answer)
	}
	if status := waitForJob(w, jobID); status != "succeeded" {
		t.Fatalf("made right after the answer: %s", status)
	}
	if code, answer := w.call("POST", "/api/v1/media/"+assetID+"/delete", "", screensSecret, w.cookie); code != 200 || answer["outcome"] != "deleted" {
		t.Fatalf("deleted: %d %v", code, answer)
	}
	if code, _ := w.call("GET", "/api/v1/media/"+assetID+"/file", "", screensSecret, w.cookie); code != 404 {
		t.Fatalf("gone: %d", code)
	}
}

func waitForJob(w *apiWorld, jobID string) string {
	var status string
	for range 100 {
		w.pool.QueryRow(context.Background(), `SELECT status FROM media_generation_jobs WHERE company_id = $1 AND id = $2`, w.company.String(), jobID).Scan(&status)
		if status == "succeeded" || status == "failed" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	return status
}
