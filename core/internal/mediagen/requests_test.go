package mediagen

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"ansa/core/internal/media"
)

func TestTheStandInsImageIsKeptLinkedToItsRequest(t *testing.T) {
	w := newGenWorld(t, ModeFor("", false))
	ctx := context.Background()
	id := w.request("image", "A loaf")
	if outcome := w.service.Run(ctx, w.company, id); outcome != Succeeded {
		t.Fatalf("made after the answer: %s", outcome)
	}
	status, _, assetID := w.job(id)
	if status != "succeeded" || assetID == nil {
		t.Fatalf("succeeded and linked: %s", status)
	}
	asset, key, _ := media.Find(ctx, w.pool, w.company, *assetID)
	if asset.Source != "generated" || *asset.Provider != StandInName || *asset.Width != 1024 || key != "media/"+w.company.String()+"/"+*assetID+".png" {
		t.Fatalf("a generated PNG under the company's folder: %+v %q", asset, key)
	}
	if _, err := os.Stat(filepath.Join(w.service.Files.DevFolder, ".dev-files", key)); err != nil {
		t.Fatalf("the file is stored: %v", err)
	}
	video := w.request("video", "A clip")
	w.service.Run(ctx, w.company, video)
	if status, code, asset := w.job(video); status != "failed" || *code != "no_video_provider" || asset != nil {
		t.Fatalf("the stand-in makes no video, and says so: %s", status)
	}
}

func TestProductionWithoutAServiceAsksNothing(t *testing.T) {
	w := newGenWorld(t, ModeFor("", true))
	ctx := context.Background()
	if _, refusal, _ := w.service.Request(ctx, w.company, w.owner, "image", "A loaf"); refusal != Off {
		t.Fatalf("off: %q", refusal)
	}
	if w.count(`SELECT count(*) FROM media_generation_jobs WHERE company_id = $1`) != 0 {
		t.Fatal("nothing is saved")
	}
	// A stand-in's job is never run by a production server.
	w.exec(`INSERT INTO media_generation_jobs (company_id, kind, prompt, provider, requested_by_user_id) VALUES ($1, 'image', 'A loaf', 'dev-stand-in', $2)`, w.company.String(), w.owner)
	var id string
	w.pool.QueryRow(ctx, `SELECT id::text FROM media_generation_jobs WHERE company_id = $1`, w.company.String()).Scan(&id)
	w.service.Run(ctx, w.company, id)
	if status, code, _ := w.job(id); status != "failed" || *code != "provider_unavailable" {
		t.Fatalf("provider_unavailable: %s", status)
	}
}

func TestTheDailyLimitAndTheCapRefuseBeforeAnythingIsSaved(t *testing.T) {
	w := newGenWorld(t, ModeFor("", false))
	ctx := context.Background()
	w.fillLibrary(298)
	w.request("image", "One")
	w.request("image", "Two")
	if _, refusal, _ := w.service.Request(ctx, w.company, w.owner, "image", "Three"); refusal != media.LibraryFull {
		t.Fatalf("requests waiting count as files: %q", refusal)
	}
	for range Generations.MaxAttempts {
		w.service.Limiter.Over(ctx, "media-generations", w.company.String(), Generations)
	}
	if _, refusal, _ := w.service.Request(ctx, w.company, w.owner, "image", "Four"); refusal != dailyLimit {
		t.Fatalf("the company's daily limit: %q", refusal)
	}
}

func TestAResultComingBackToAFullLibraryIsNotKept(t *testing.T) {
	w := newGenWorld(t, ModeFor("", false))
	ctx := context.Background()
	id := w.request("image", "A loaf")
	w.fillLibrary(300)
	if outcome := w.service.Run(ctx, w.company, id); outcome != Failed {
		t.Fatalf("failed: %s", outcome)
	}
	if status, code, asset := w.job(id); status != "failed" || *code != "library_full" || asset != nil {
		t.Fatalf("library_full, no asset: %s", status)
	}
	entries, _ := os.ReadDir(filepath.Join(w.service.Files.DevFolder, ".dev-files", "media", w.company.String()))
	if len(entries) != 0 {
		t.Fatal("no file left behind")
	}
}

func TestADraftsImageIsAttachedOnlyAtTheVersionItWasAskedAt(t *testing.T) {
	w := newGenWorld(t, ModeFor("", false))
	ctx := context.Background()
	draft := w.imageDraft()
	first, refusal, _ := w.service.RequestForDraft(ctx, w.company, w.owner, draft, 1)
	if first == "" || refusal != "" {
		t.Fatalf("asked: %q", refusal)
	}
	if _, refusal, _ := w.service.RequestForDraft(ctx, w.company, w.owner, draft, 1); refusal != draftBusy {
		t.Fatalf("one request per draft at a time: %q", refusal)
	}
	w.service.Run(ctx, w.company, first)
	var version int
	var attached *string
	w.pool.QueryRow(ctx, `SELECT version, media_asset_id::text FROM content_drafts WHERE company_id = $1 AND id = $2`, w.company.String(), draft).Scan(&version, &attached)
	if version != 2 || attached == nil {
		t.Fatalf("attached as the next version: %d %v", version, attached)
	}
	if _, refusal, _ := w.service.RequestForDraft(ctx, w.company, w.owner, draft, 1); refusal != draftStale {
		t.Fatalf("a version that moved on: %q", refusal)
	}
	second, _, _ := w.service.RequestForDraft(ctx, w.company, w.owner, draft, 2)
	w.exec(`UPDATE content_drafts SET version = version + 1, body = 'Edited.' WHERE company_id = $1 AND id = $2`, w.company.String(), draft)
	w.service.Run(ctx, w.company, second)
	_, _, made := w.job(second)
	w.pool.QueryRow(ctx, `SELECT media_asset_id::text FROM content_drafts WHERE company_id = $1 AND id = $2`, w.company.String(), draft).Scan(&attached)
	if made == nil || *attached == *made {
		t.Fatal("changed meanwhile: kept in the library, not attached")
	}
}

func TestANewRequestOverAStuckOneEndsItAsSuperseded(t *testing.T) {
	w := newGenWorld(t, ModeFor("", false))
	ctx := context.Background()
	draft := w.imageDraft()
	stuck, _, _ := w.service.RequestForDraft(ctx, w.company, w.owner, draft, 1)
	w.exec(`UPDATE media_generation_jobs SET created_at = now() - interval '3 minutes' WHERE company_id = $1 AND id = $2`, w.company.String(), stuck)
	if fresh, refusal, _ := w.service.RequestForDraft(ctx, w.company, w.owner, draft, 1); fresh == "" || refusal != "" {
		t.Fatalf("a stuck request doesn't block a new one: %q", refusal)
	}
	if status, code, _ := w.job(stuck); status != "failed" || *code != "superseded" {
		t.Fatalf("superseded, so it never runs: %s", status)
	}
	if outcome := w.service.Run(ctx, w.company, stuck); outcome != NotClaimed {
		t.Fatalf("never run: %s", outcome)
	}
}
