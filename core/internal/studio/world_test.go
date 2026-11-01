package studio

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/database"
	"ansa/core/internal/drafts"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/tenant"
)

// studioWorld is one test company with an owner and a member, a fake brain
// (never the real AI) and the writer.
type studioWorld struct {
	t       *testing.T
	pool    *database.Pool
	company tenant.CompanyID
	owner   string
	member  string
	writer  *Writer
	mu      sync.Mutex
	answers []string
	asked   []map[string]any
	// Runs while the fake brain "writes" (an edit saved meanwhile).
	whileWriting func()
}

func newStudioWorld(t *testing.T) *studioWorld {
	t.Helper()
	w := &studioWorld{t: t, pool: database.ForTest(t)}
	companyID := database.TestCompany(t, w.pool)
	w.company, _ = tenant.FromTrustedSource(companyID)
	w.owner = database.TestOwner(t, w.pool, companyID)
	w.member = database.TestOwner(t, w.pool, companyID)
	w.exec(`UPDATE users SET role = 'member' WHERE company_id = $1 AND id = $2`, companyID, w.member)
	brain := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		var request map[string]any
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &request)
		if w.whileWriting != nil {
			w.whileWriting()
		}
		w.mu.Lock()
		w.asked = append(w.asked, request)
		answer := `{"kind":"failed","reason":"model_failed","error_name":"APITimeoutError"}`
		if len(w.answers) > 0 {
			answer, w.answers = w.answers[0], w.answers[1:]
		}
		w.mu.Unlock()
		rw.Header().Set("Content-Type", "application/json")
		io.WriteString(rw, answer)
	}))
	t.Cleanup(brain.Close)
	limiter := ratelimit.New(w.pool, "studio-test-secret-of-at-least-32-characters")
	t.Cleanup(func() {
		w.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, limiter.Key("content-generations", companyID))
	})
	w.writer = &Writer{Pool: w.pool, Brain: brainclient.New(brain.URL, strings.Repeat("s", 40), 5*time.Second), Limiter: limiter, Log: logging.New(io.Discard)}
	return w
}

func (w *studioWorld) exec(statement string, args ...any) {
	w.t.Helper()
	if _, err := w.pool.Exec(context.Background(), statement, args...); err != nil {
		w.t.Fatalf("setting up: %v", err)
	}
}

// confirm confirms a business fact as the owner.
func (w *studioWorld) confirm(topic, value string) {
	w.exec(`INSERT INTO business_facts (company_id, topic, confirmed_value, confirmed_source, confirmed_by_user_id, confirmed_at)
		VALUES ($1, $2, $3, 'owner', $4, now())
		ON CONFLICT (company_id, topic) DO UPDATE SET confirmed_value = EXCLUDED.confirmed_value`, w.company.String(), topic, value, w.owner)
}

// draft saves a draft the AI wrote, with claims as stored and the facts sent.
func (w *studioWorld) draft(platform, format, body string, claims []drafts.StoredClaim, sent []drafts.Fact) string {
	w.t.Helper()
	g := &Generated{Fields: drafts.Fields{Body: body}, Claims: claims, FactsUsed: sent, KnowledgeUsed: []string{}}
	id, outcome, err := Create(context.Background(), w.pool, w.company, w.member, NewDraft{Platform: platform, Format: format, Placement: Placement{Topic: "Our bread"}}, g)
	if err != nil || outcome != "created" {
		w.t.Fatalf("making a draft: %v %s", err, outcome)
	}
	return id
}

// row reads one draft's status, version and approval.
func (w *studioWorld) row(draftID string) (status string, version int, approvedVersion *int, approvedBy, acknowledgedBy, note *string) {
	w.t.Helper()
	err := w.pool.QueryRow(context.Background(), `SELECT status, version, approved_version, approved_by_user_id, claims_acknowledged_by_user_id, rejection_note
		FROM content_drafts WHERE company_id = $1 AND id = $2`, w.company.String(), draftID).Scan(&status, &version, &approvedVersion, &approvedBy, &acknowledgedBy, &note)
	if err != nil {
		w.t.Fatalf("reading the draft: %v", err)
	}
	return
}

func (w *studioWorld) countDrafts() int {
	var n int
	w.pool.QueryRow(context.Background(), `SELECT count(*) FROM content_drafts WHERE company_id = $1`, w.company.String()).Scan(&n)
	return n
}

var backedClaim = []drafts.StoredClaim{{Text: "Baked since 1998", Supported: true, FactTopics: []string{"description"}}}
var sentFacts = []drafts.Fact{{Topic: "description", Value: "A bakery since 1998"}}
