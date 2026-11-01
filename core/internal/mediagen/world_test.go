package mediagen

import (
	"context"
	"io"
	"sync"
	"testing"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/drafts"
	"ansa/core/internal/files"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/tenant"
)

// fakeService is an image service for the tests (never a real one).
type fakeService struct {
	mu            sync.Mutex
	starts, polls int
	start         func(Request) (Started, error)
	poll          func(string) (Polled, error)
}

func (*fakeService) Name() string                  { return "fake-service" }
func (*fakeService) IsStandIn() bool               { return false }
func (*fakeService) Kinds() []string               { return []string{"image", "video"} }
func (*fakeService) OutputHosts() []string         { return []string{"files.fake-service.test"} }
func (*fakeService) RequestTimeout() time.Duration { return 2 * time.Second }
func (*fakeService) PollInterval() time.Duration   { return time.Millisecond }

func (f *fakeService) Start(_ context.Context, request Request) (Started, error) {
	f.mu.Lock()
	f.starts++
	f.mu.Unlock()
	return f.start(request)
}

func (f *fakeService) Poll(_ context.Context, id string) (Polled, error) {
	f.mu.Lock()
	f.polls++
	f.mu.Unlock()
	return f.poll(id)
}

type genWorld struct {
	t       *testing.T
	pool    *database.Pool
	company tenant.CompanyID
	owner   string
	service *Service
}

// newGenWorld is a test company whose server uses this mode.
func newGenWorld(t *testing.T, mode Mode) *genWorld {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	limiter := ratelimit.New(pool, "mediagen-test-secret-of-at-least-32-characters")
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, limiter.Key("media-generations", companyID))
	})
	service := &Service{Pool: pool, Files: &files.Store{DevFolder: t.TempDir()}, Limiter: limiter, Log: logging.New(io.Discard), Mode: mode,
		Sleep: func(time.Duration) {}, Budget: 200 * time.Millisecond}
	return &genWorld{t: t, pool: pool, company: company, owner: database.TestOwner(t, pool, companyID), service: service}
}

func (w *genWorld) exec(statement string, args ...any) {
	w.t.Helper()
	if _, err := w.pool.Exec(context.Background(), statement, args...); err != nil {
		w.t.Fatalf("setup: %v", err)
	}
}

func (w *genWorld) request(kind, prompt string) string {
	w.t.Helper()
	id, refusal, err := w.service.Request(context.Background(), w.company, w.owner, kind, prompt)
	if err != nil || refusal != "" {
		w.t.Fatalf("request: %v %q", err, refusal)
	}
	return id
}

// job reads one request's status, error and asset.
func (w *genWorld) job(id string) (status string, lastError, assetID *string) {
	w.t.Helper()
	err := w.pool.QueryRow(context.Background(), `SELECT status, last_error, asset_id::text FROM media_generation_jobs WHERE company_id = $1 AND id = $2`,
		w.company.String(), id).Scan(&status, &lastError, &assetID)
	if err != nil {
		w.t.Fatalf("job: %v", err)
	}
	return
}

func (w *genWorld) count(statement string) int {
	var n int
	w.pool.QueryRow(context.Background(), statement, w.company.String()).Scan(&n)
	return n
}

// imageDraft is a post with an image whose saved description is a prompt.
func (w *genWorld) imageDraft() string {
	w.t.Helper()
	id, err := drafts.Create(context.Background(), w.pool, w.company, w.owner, drafts.NewDraft{Platform: "facebook", Format: "image_post", Topic: "Bread", Body: "Fresh bread."})
	if err != nil {
		w.t.Fatalf("draft: %v", err)
	}
	w.exec(`UPDATE content_drafts SET image_prompt = 'A loaf on a table' WHERE company_id = $1 AND id = $2`, w.company.String(), id)
	return id
}

// fillLibrary adds n small uploaded assets.
func (w *genWorld) fillLibrary(n int) {
	w.exec(`INSERT INTO media_assets (id, company_id, kind, source, content_type, size_bytes, storage_key, original_name, created_by_user_id)
		SELECT g.id, $1::uuid, 'image', 'upload', 'image/png', 10, 'media/' || $1::text || '/' || g.id || '.png', 'x.png', $2
		FROM (SELECT gen_random_uuid() AS id FROM generate_series(1, $3::int)) AS g`, w.company.String(), w.owner, n)
}
