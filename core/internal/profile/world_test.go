package profile

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
	"ansa/core/internal/logging"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// world is one test company with an owner, and a fake brain that answers
// in turn and keeps what it was asked (never the real model).
type world struct {
	t       *testing.T
	pool    *database.Pool
	company tenant.CompanyID
	owner   string
	service *Service
	mutex   sync.Mutex
	answers []string
	asked   []map[string]any
}

func newWorld(t *testing.T) *world {
	t.Helper()
	w := &world{t: t, pool: database.ForTest(t)}
	companyID := database.TestCompany(t, w.pool)
	w.company, _ = tenant.FromTrustedSource(companyID)
	w.owner = database.TestOwner(t, w.pool, companyID)
	box, _ := secure.NewBox("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	brain := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		var request map[string]any
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &request)
		w.mutex.Lock()
		defer w.mutex.Unlock()
		request["path"] = r.URL.Path
		w.asked = append(w.asked, request)
		answer := `{"kind":"failed","reason":"model_failed","error_name":"APITimeoutError"}`
		if len(w.answers) > 0 {
			answer, w.answers = w.answers[0], w.answers[1:]
		}
		io.WriteString(rw, answer)
	}))
	t.Cleanup(brain.Close)
	w.service = &Service{Pool: w.pool, Box: box, Brain: brainclient.New(brain.URL, strings.Repeat("s", 40), 5*time.Second), Log: logging.New(io.Discard)}
	return w
}

// must runs a statement of the test's own setup.
func (w *world) must(statement string, args ...any) {
	w.t.Helper()
	if _, err := w.pool.Exec(context.Background(), statement, args...); err != nil {
		w.t.Fatalf("setup: %v", err)
	}
}

// count reads one number about the test company ($1).
func (w *world) count(statement string) int {
	w.t.Helper()
	var n int
	if err := w.pool.QueryRow(context.Background(), statement, w.company.String()).Scan(&n); err != nil {
		w.t.Fatalf("count: %v", err)
	}
	return n
}

// facts are the test company's values now.
func (w *world) facts() Facts {
	w.t.Helper()
	facts, err := ReadFacts(context.Background(), w.pool, w.company)
	if err != nil {
		w.t.Fatalf("facts: %v", err)
	}
	return facts
}

// member adds a confirmed member to the test company.
func (w *world) member() string {
	w.t.Helper()
	var id string
	err := w.pool.QueryRow(context.Background(), `
		INSERT INTO users (id, company_id, role, name, email, email_verified)
		VALUES (gen_random_uuid()::text, $1, 'member', 'Core Test Member', gen_random_uuid()::text || '@core-test.example', true)
		RETURNING id`, w.company.String()).Scan(&id)
	if err != nil {
		w.t.Fatalf("member: %v", err)
	}
	return id
}

// reply queues the brain's next answer.
func (w *world) reply(answer string) {
	w.mutex.Lock()
	defer w.mutex.Unlock()
	w.answers = append(w.answers, answer)
}

// lastAsked is the newest request the brain got.
func (w *world) lastAsked() map[string]any {
	w.mutex.Lock()
	defer w.mutex.Unlock()
	if len(w.asked) == 0 {
		w.t.Fatal("the brain was never asked")
	}
	return w.asked[len(w.asked)-1]
}

func (w *world) timesAsked() int {
	w.mutex.Lock()
	defer w.mutex.Unlock()
	return len(w.asked)
}
