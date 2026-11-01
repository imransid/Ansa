package media

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/drafts"
	"ansa/core/internal/files"
	"ansa/core/internal/tenant"
)

type mediaWorld struct {
	t       *testing.T
	pool    *database.Pool
	store   *files.Store
	company tenant.CompanyID
	owner   string
}

func newMediaWorld(t *testing.T) *mediaWorld {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	return &mediaWorld{t: t, pool: pool, store: &files.Store{DevFolder: t.TempDir()}, company: company, owner: database.TestOwner(t, pool, companyID)}
}

func (w *mediaWorld) upload(name string, data []byte) string {
	w.t.Helper()
	id, err := Upload(context.Background(), w.pool, w.store, w.company, w.owner, name, data, "A loaf on a table")
	if err != nil {
		w.t.Fatalf("upload: %v", err)
	}
	return id
}

// draft makes a draft the AI wrote, of this format (body "" = an idea).
func (w *mediaWorld) draft(format, body string) string {
	w.t.Helper()
	id, err := drafts.Create(context.Background(), w.pool, w.company, w.owner, drafts.NewDraft{Platform: "facebook", Format: format, Topic: "Bread", Body: body, Generated: body != ""})
	if err != nil {
		w.t.Fatalf("draft: %v", err)
	}
	return id
}

func (w *mediaWorld) exec(statement string, args ...any) {
	w.t.Helper()
	if _, err := w.pool.Exec(context.Background(), statement, args...); err != nil {
		w.t.Fatalf("setup: %v", err)
	}
}

func (w *mediaWorld) approve(draftID string) {
	w.exec(`UPDATE content_drafts SET status = 'approved', approved_by_user_id = $3, approved_at = now(), approved_version = version
		WHERE company_id = $1 AND id = $2`, w.company.String(), draftID, w.owner)
}

func (w *mediaWorld) state(draftID string) (status string, version int, generated *int, approved *int, asset *string) {
	w.t.Helper()
	err := w.pool.QueryRow(context.Background(), `SELECT status, version, generated_version, approved_version, media_asset_id::text
		FROM content_drafts WHERE company_id = $1 AND id = $2`, w.company.String(), draftID).Scan(&status, &version, &generated, &approved, &asset)
	if err != nil {
		w.t.Fatalf("draft state: %v", err)
	}
	return
}

func TestAnUploadIsStoredUnderItsCompanyWithWhatItsBytesSay(t *testing.T) {
	w := newMediaWorld(t)
	ctx := context.Background()
	id := w.upload("my\u202ephoto\n.png", pngBytes(64, 32))
	asset, key, err := Find(ctx, w.pool, w.company, id)
	if err != nil || asset == nil || key != "media/"+w.company.String()+"/"+id+".png" {
		t.Fatalf("stored under its company's folder: %v %q", err, key)
	}
	if asset.Kind != "image" || asset.ContentType != "image/png" || *asset.Width != 64 || *asset.Height != 32 || *asset.OriginalName != "myphoto .png" || asset.AltText != "A loaf on a table" {
		t.Fatalf("what its bytes say: %+v", asset)
	}
	if _, err := os.Stat(filepath.Join(w.store.DevFolder, ".dev-files", key)); err != nil {
		t.Fatalf("the file is in private storage: %v", err)
	}
	otherID := database.TestCompany(t, w.pool)
	other, _ := tenant.FromTrustedSource(otherID)
	if found, _, _ := Find(ctx, w.pool, other, id); found != nil {
		t.Fatal("another company can't read it")
	}
	if list, _ := List(ctx, w.pool, other, 1); len(list) != 0 {
		t.Fatal("another company can't list it")
	}
	if change, _ := Delete(ctx, w.pool, other, database.TestOwner(t, w.pool, otherID), id); change.Outcome != NotFound {
		t.Fatalf("another company can't delete it: %s", change.Outcome)
	}
}

func TestTheLibraryKeepsAtMost500MB(t *testing.T) {
	w := newMediaWorld(t)
	w.exec(`INSERT INTO media_assets (id, company_id, kind, source, content_type, size_bytes, storage_key, original_name, created_by_user_id)
		SELECT g.id, $1::uuid, 'image', 'upload', 'image/png', 104857600, 'media/' || $1::text || '/' || g.id || '.png', 'big.png', $2
		FROM (SELECT gen_random_uuid() AS id FROM generate_series(1, 5)) AS g`, w.company.String(), w.owner)
	if _, err := Upload(context.Background(), w.pool, w.store, w.company, w.owner, "one.png", pngBytes(2, 2), ""); err != ErrFull {
		t.Fatalf("a full library refuses: %v", err)
	}
}

func TestAttachingIsAChangeOfContentThatKeepsTheAIsText(t *testing.T) {
	w := newMediaWorld(t)
	ctx := context.Background()
	image := w.upload("loaf.png", pngBytes(2, 2))
	video := w.upload("clip.mp4", []byte("\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2"))
	draft := w.draft("image_post", "Fresh bread.")
	w.approve(draft)
	if outcome, _ := SetDraftMedia(ctx, w.pool, w.company, w.owner, draft, 1, &image); outcome != Changed {
		t.Fatalf("attached: %s", outcome)
	}
	status, version, generated, approved, asset := w.state(draft)
	if status != "draft" || version != 2 || generated == nil || *generated != 2 || approved != nil || *asset != image {
		t.Fatalf("the next version, without its approval, the text still the AI's: %s %d %v", status, version, generated)
	}
	for name, try := range map[string]func() (string, error){
		WrongKind: func() (string, error) { return SetDraftMedia(ctx, w.pool, w.company, w.owner, draft, 2, &video) },
		Stale:     func() (string, error) { return SetDraftMedia(ctx, w.pool, w.company, w.owner, draft, 1, nil) },
		Unchanged: func() (string, error) { return SetDraftMedia(ctx, w.pool, w.company, w.owner, draft, 2, &image) },
		MediaNotFound: func() (string, error) {
			missing := "00000000-0000-0000-0000-000000000000"
			return SetDraftMedia(ctx, w.pool, w.company, w.owner, draft, 2, &missing)
		},
	} {
		if outcome, err := try(); outcome != name || err != nil {
			t.Fatalf("%s: %s %v", name, outcome, err)
		}
	}
	text := w.draft("post", "Just words.")
	if outcome, _ := SetDraftMedia(ctx, w.pool, w.company, w.owner, text, 1, &image); outcome != WrongKind {
		t.Fatalf("a text post takes none: %s", outcome)
	}
	idea := w.draft("image_post", "")
	SetDraftMedia(ctx, w.pool, w.company, w.owner, idea, 1, &image)
	if status, _, _, _, _ := w.state(idea); status != "draft" {
		t.Fatalf("an idea with an image is a draft: %s", status)
	}
	SetDraftMedia(ctx, w.pool, w.company, w.owner, idea, 2, nil)
	if status, _, _, _, _ := w.state(idea); status != "idea" {
		t.Fatalf("an idea again once it is taken off: %s", status)
	}
}

func TestAltTextIsANewVersionOfEveryDraftUsingIt(t *testing.T) {
	w := newMediaWorld(t)
	ctx := context.Background()
	image := w.upload("loaf.png", pngBytes(2, 2))
	approved, archived := w.draft("image_post", "Bread."), w.draft("image_post", "Old bread.")
	for _, id := range []string{approved, archived} {
		SetDraftMedia(ctx, w.pool, w.company, w.owner, id, 1, &image)
	}
	w.approve(approved)
	w.exec(`UPDATE content_drafts SET status = 'archived' WHERE company_id = $1 AND id = $2`, w.company.String(), archived)
	if change, _ := UpdateAltText(ctx, w.pool, w.company, w.owner, image, "Two loaves"); change.Outcome != Changed {
		t.Fatalf("saved: %s", change.Outcome)
	}
	if status, version, _, approval, _ := w.state(approved); status != "draft" || version != 3 || approval != nil {
		t.Fatalf("an approved draft is a draft again, as its next version: %s %d", status, version)
	}
	if status, version, _, _, _ := w.state(archived); status != "archived" || version != 3 {
		t.Fatalf("an archived one stays archived: %s %d", status, version)
	}
	if change, _ := UpdateAltText(ctx, w.pool, w.company, w.owner, image, "Two loaves"); change.Outcome != Unchanged {
		t.Fatalf("the same text again changes nothing: %s", change.Outcome)
	}
	w.exec(`UPDATE content_drafts SET status = 'scheduled' WHERE company_id = $1 AND id = $2`, w.company.String(), approved)
	change, _ := UpdateAltText(ctx, w.pool, w.company, w.owner, image, "Three loaves")
	if change.Outcome != InUse || !strings.Contains(DraftsUsingWords(change.Drafts), "the draft “Bread” (Scheduled) uses") {
		t.Fatalf("refused while a scheduled draft uses it, naming it: %+v", change)
	}
}

func TestDeletingIsRefusedWhileAnApprovedDraftUsesIt(t *testing.T) {
	w := newMediaWorld(t)
	ctx := context.Background()
	image := w.upload("loaf.png", pngBytes(2, 2))
	draft := w.draft("image_post", "Bread.")
	SetDraftMedia(ctx, w.pool, w.company, w.owner, draft, 1, &image)
	w.approve(draft)
	if change, _ := Delete(ctx, w.pool, w.company, w.owner, image); change.Outcome != InUse || change.Drafts[0].DraftID != draft {
		t.Fatalf("an approved draft keeps its image: %+v", change)
	}
	w.exec(`UPDATE content_drafts SET status = 'draft', approved_by_user_id = NULL, approved_at = NULL, approved_version = NULL WHERE company_id = $1 AND id = $2`, w.company.String(), draft)
	change, err := Delete(ctx, w.pool, w.company, w.owner, image)
	if err != nil || change.Outcome != "deleted" || !strings.HasSuffix(change.StorageKey, image+".png") {
		t.Fatalf("deleted: %+v %v", change, err)
	}
	if _, version, _, _, asset := w.state(draft); asset != nil || version != 3 {
		t.Fatalf("its draft loses it as its next version: %d %v", version, asset)
	}
}
