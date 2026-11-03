package comments

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/messenger"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// commentWorld is one business with its stand-in Facebook Page, comments
// switched on, a menu, a fake brain (never the real model) and the answerer.
type commentWorld struct {
	t          *testing.T
	pool       *database.Pool
	box        *secure.Box
	company    tenant.CompanyID
	owner      string
	connection string
	pageID     string
	answerer   *Answerer
	outbox     string
	mu         sync.Mutex
	// What the fake brain answers next ("" = it is down), and what it was asked.
	brainAnswer string
	asked       []BrainRequest
}

func newCommentWorld(t *testing.T) *commentWorld {
	pool := database.ForTest(t)
	w := &commentWorld{t: t, pool: pool, outbox: t.TempDir(), pageID: "dev:stand-in"}
	companyID := database.TestCompany(t, pool)
	w.company, _ = tenant.FromTrustedSource(companyID)
	w.owner = database.TestOwner(t, pool, companyID)
	w.box, _ = secure.NewBox("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	w.must(`UPDATE companies SET name = 'Shapla Kitchen' WHERE id = $1`, companyID)
	w.must(`INSERT INTO assistant_settings (company_id, comments_on, currency, holding_reply) VALUES ($1, true, 'BDT', 'Thanks! Our team will get back to you soon.')`, companyID)
	w.must(`INSERT INTO catalog_items (company_id, category, name, price_cents, position) VALUES ($1, 'Rice', 'Kacchi Biryani', 45000, 1)`, companyID)
	w.must(`INSERT INTO social_connections (company_id, platform, external_account_id, display_name, account_kind, scopes, access_token_encrypted, connected_by_user_id, is_stand_in)
		VALUES ($1, 'facebook', 'dev:stand-in', 'Shapla Kitchen', 'page', '{}', 'v1:x:y:z', $2, true)`, companyID, w.owner)
	pool.QueryRow(context.Background(), `SELECT id::text FROM social_connections WHERE company_id = $1`, companyID).Scan(&w.connection)
	brain := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		w.mu.Lock()
		defer w.mu.Unlock()
		var request BrainRequest
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &request)
		w.asked = append(w.asked, request)
		if w.brainAnswer == "" {
			rw.WriteHeader(http.StatusInternalServerError)
			return
		}
		io.WriteString(rw, w.brainAnswer)
	}))
	t.Cleanup(brain.Close)
	limiter := ratelimit.New(pool, "core-test-secret")
	w.answerer = &Answerer{Pool: pool, Box: w.box, Limiter: limiter, Log: logging.New(io.Discard), StandInsAllowed: true, StandInDir: w.outbox,
		Brain: brainclient.New(brain.URL, strings.Repeat("s", 40), 5*time.Second)}
	t.Cleanup(func() {
		pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, limiter.Key("comment-answers", companyID))
	})
	return w
}

func (w *commentWorld) must(statement string, args ...any) {
	if _, err := w.pool.Exec(context.Background(), statement, args...); err != nil {
		w.t.Fatalf("setup: %v", err)
	}
}

func (w *commentWorld) count(statement string, args ...any) int {
	var n int
	if err := w.pool.QueryRow(context.Background(), statement, append([]any{w.company.String()}, args...)...).Scan(&n); err != nil {
		w.t.Fatalf("count: %v", err)
	}
	return n
}

// brainSays sets the fake brain's next proposal.
func (w *commentWorld) brainSays(kind string, fields map[string]string) {
	answer := map[string]string{"kind": kind}
	for key, value := range fields {
		answer[key] = value
	}
	body, _ := json.Marshal(answer)
	w.mu.Lock()
	defer w.mu.Unlock()
	w.brainAnswer = string(body)
}

// comment saves a comment as the webhook does; its row id ("" = not saved).
func (w *commentWorld) comment(commentID, fromID, text string, changes ...func(*messenger.CommentEvent)) string {
	event := messenger.CommentEvent{PageID: w.pageID, PostID: "dev-post-1", CommentID: commentID, ParentID: "dev-post-1", FromID: fromID, FromName: "Lena",
		Message: text, CreatedAt: time.Now()}
	for _, change := range changes {
		change(&event)
	}
	id, err := Save(context.Background(), w.pool, w.box, w.company, w.connection, event, time.Now())
	if err != nil {
		w.t.Fatalf("saving the comment: %v", err)
	}
	w.t.Cleanup(func() {
		w.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, w.answerer.Limiter.Key("comment-commenters", CommenterKey(w.company, w.pageID, fromID)))
	})
	return id
}

// answer runs the answering job's work for one comment.
func (w *commentWorld) answer(id string) string {
	outcome, err := w.answerer.Answer(context.Background(), w.company, id)
	if err != nil {
		w.t.Fatalf("Answer: %v", err)
	}
	return outcome
}

// view is the comment as the page shows it.
func (w *commentWorld) view(id string) *View {
	view, err := ReadOne(context.Background(), w.pool, w.box, w.company, id)
	if err != nil {
		w.t.Fatalf("ReadOne: %v", err)
	}
	return view
}

// written are the stand-in Page's files: what would have gone to Meta.
func (w *commentWorld) written() map[string]string {
	files, _ := os.ReadDir(w.outbox)
	found := map[string]string{}
	for _, file := range files {
		body, _ := os.ReadFile(filepath.Join(w.outbox, file.Name()))
		var sent map[string]string
		json.Unmarshal(body, &sent)
		found[sent["to"]] = sent["text"]
	}
	return found
}
