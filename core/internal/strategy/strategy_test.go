package strategy

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
	"ansa/core/internal/knowledge"
	"ansa/core/internal/logging"
	"ansa/core/internal/profile"
	"ansa/core/internal/tenant"
)

type planWorld struct {
	pool    *database.Pool
	company tenant.CompanyID
	owner   string
	planner *Planner
	mutex   sync.Mutex
	answers []string
	asked   []map[string]any
}

func newPlanWorld(t *testing.T) *planWorld {
	t.Helper()
	w := &planWorld{pool: database.ForTest(t)}
	companyID := database.TestCompany(t, w.pool)
	w.company, _ = tenant.FromTrustedSource(companyID)
	w.owner = database.TestOwner(t, w.pool, companyID)
	brain := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		var request map[string]any
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &request)
		w.mutex.Lock()
		defer w.mutex.Unlock()
		w.asked = append(w.asked, request)
		answer := `{"kind":"failed","reason":"model_failed","error_name":"APITimeoutError"}`
		if len(w.answers) > 0 {
			answer, w.answers = w.answers[0], w.answers[1:]
		}
		io.WriteString(rw, answer)
	}))
	t.Cleanup(brain.Close)
	w.planner = &Planner{Pool: w.pool, Brain: brainclient.New(brain.URL, strings.Repeat("s", 40), 5*time.Second), Log: logging.New(io.Discard)}
	return w
}

// confirm types confirmed facts of the test company, as an owner would.
func (w *planWorld) confirm(t *testing.T, facts map[string]string) {
	t.Helper()
	for topic, value := range facts {
		if outcome, err := profile.SaveValue(context.Background(), w.pool, w.company, w.owner, topic, "", value); err != nil || outcome != profile.Changed {
			t.Fatalf("confirming %s: %s %v", topic, outcome, err)
		}
	}
}

func (w *planWorld) answerWith(plan []byte) {
	w.mutex.Lock()
	defer w.mutex.Unlock()
	w.answers = append(w.answers, `{"kind":"ok","plan":`+string(plan)+`}`)
}

func TestAPlanIsMadeFromConfirmedFactsOnlyAndSavedAsTheNextVersion(t *testing.T) {
	w := newPlanWorld(t)
	ctx := context.Background()
	if result, _ := w.planner.Make(ctx, w.company, w.owner, ""); result.Outcome != NotReady || len(result.Missing) != 3 || len(w.asked) != 0 {
		t.Fatalf("without what a plan needs nobody is asked: %+v", result)
	}
	w.confirm(t, map[string]string{"description": "We bake.", "products": "Sourdough loaves", "target_customers": "Neighbours"})
	err := database.InTx(ctx, w.pool, func(tx database.Tx) error {
		_, err := profile.SaveProposalsWithin(ctx, tx, w.company, []profile.Proposal{{Topic: "prices", Value: "Secret proposal"}}, profile.SourceInterview)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	ids, _, _ := knowledge.CreateDrafts(ctx, w.pool, w.company, w.owner, []knowledge.Fields{{Title: "Our sourdough", Body: "Sourdough baked overnight.", Kind: "product", UseForMarketing: true}}, knowledge.Source{})
	detail, _ := knowledge.Read(ctx, w.pool, w.company, ids[0])
	knowledge.ChangeStatus(ctx, w.pool, w.company, w.owner, ids[0], "approve", detail.Revision)
	w.answerWith(goodPlan(nil))
	result, err := w.planner.Make(ctx, w.company, w.owner, "Weekends")
	if err != nil || result.Outcome != Made || result.Version != 1 {
		t.Fatalf("made: %+v %v", result, err)
	}
	asked, _ := json.Marshal(w.asked[0])
	for _, absent := range []string{"Secret proposal", w.company.String(), w.owner, "support_trends", "past_performance"} {
		if strings.Contains(string(asked), absent) {
			t.Fatalf("the request holds %q: %s", absent, asked)
		}
	}
	if len(w.asked[0]["facts"].([]any)) != 3 || len(w.asked[0]["unconfirmed_topics"].([]any)) != 22 || w.asked[0]["goal_note"] != "Weekends" ||
		!strings.Contains(w.asked[0]["knowledge"].(string), `<article title="Our sourdough">`) {
		t.Fatalf("the request: %s", asked)
	}
	page, _ := ReadPage(ctx, w.pool, w.company)
	current := page.Current
	if current == nil || current.Content == nil || current.Version != 1 || len(current.FactsUsed) != 3 || len(current.KnowledgeUsed) != 1 ||
		*current.KnowledgeUsed[0].Title != "Our sourdough" || *current.GoalNote != "Weekends" || current.ProfileChangedSince || page.NewestVersion != 1 {
		t.Fatalf("the page: %+v", current)
	}
	if n := countRows(t, w, `SELECT count(*) FROM cofounder_activity WHERE company_id = $1 AND action = 'plan_created' AND plan_version = 1`); n != 1 {
		t.Fatal("the activity log records the plan")
	}
	w.confirm(t, map[string]string{"goals": "More regulars"})
	if page, _ := ReadPage(ctx, w.pool, w.company); !page.Current.ProfileChangedSince {
		t.Fatal("the page says the profile changed since")
	}
}

func TestVersionsCountPerCompanyAndOnlyOwnersSave(t *testing.T) {
	w := newPlanWorld(t)
	ctx := context.Background()
	plan, _ := ReadPlan(goodPlan(nil), nil)
	versions := make(chan int, 3)
	var group sync.WaitGroup
	for range 3 {
		group.Add(1)
		go func() {
			defer group.Done()
			version, _, err := SavePlan(ctx, w.pool, w.company, w.owner, NewPlan{Plan: plan, FactsUsed: []UsedFact{}})
			if err != nil {
				t.Errorf("saving: %v", err)
			}
			versions <- version
		}()
	}
	group.Wait()
	close(versions)
	seen := map[int]bool{}
	for version := range versions {
		seen[version] = true
	}
	if !seen[1] || !seen[2] || !seen[3] {
		t.Fatalf("plans saved at the same moment: %v", seen)
	}
	other, _ := tenant.FromTrustedSource(database.TestCompany(t, w.pool))
	otherOwner := database.TestOwner(t, w.pool, other.String())
	if version, _, _ := SavePlan(ctx, w.pool, other, otherOwner, NewPlan{Plan: plan}); version != 1 {
		t.Fatalf("each company numbers its own versions: %d", version)
	}
	if page, _ := ReadVersionPage(ctx, w.pool, other, 3); page != nil {
		t.Fatal("another company's version")
	}
	w.mustExec(t, `UPDATE users SET role = 'member' WHERE company_id = $1`, w.company.String())
	if _, outcome, _ := SavePlan(ctx, w.pool, w.company, w.owner, NewPlan{Plan: plan}); outcome != profile.NotAllowed {
		t.Fatalf("an owner made a member saved a plan: %s", outcome)
	}
	if outcome, _ := SetSupportTrends(ctx, w.pool, w.company, w.owner, true); outcome != profile.NotAllowed {
		t.Fatalf("a member changed the setting: %s", outcome)
	}
}

func (w *planWorld) mustExec(t *testing.T, statement string, args ...any) {
	t.Helper()
	if _, err := w.pool.Exec(context.Background(), statement, args...); err != nil {
		t.Fatalf("setup: %v", err)
	}
}

func countRows(t *testing.T, w *planWorld, statement string) int {
	t.Helper()
	var n int
	if err := w.pool.QueryRow(context.Background(), statement, w.company.String()).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}
