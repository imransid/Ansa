package calendar

import (
	"context"
	"encoding/json"
	"io"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/strategy"
	"ansa/core/internal/tenant"
)

// betterAuthOwner adds an owner whose id is Better Auth's kind (32 letters
// and digits, not a uuid), as every real account's is.
func betterAuthOwner(t *testing.T, pool *database.Pool, companyID string) string {
	t.Helper()
	const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	id := make([]byte, 32)
	for i := range id {
		id[i] = alphabet[rand.IntN(len(alphabet))]
	}
	_, err := pool.Exec(context.Background(), `INSERT INTO users (id, company_id, role, name, email, email_verified)
		VALUES ($1, $2, 'owner', 'Real Owner', $1 || '@core-test.example', true)`, string(id), companyID)
	if err != nil {
		t.Fatalf("owner: %v", err)
	}
	return string(id)
}

func TestPlanningTwoWeeksAddsIdeasOnlyAndTheCalendarShowsThem(t *testing.T) {
	pool := database.ForTest(t)
	ctx := context.Background()
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	owner := betterAuthOwner(t, pool, companyID)
	var asked []map[string]any
	answers := []string{`{"kind":"ok","posts":[
		{"date":"2026-11-04","time":"09:30","platform":"facebook","format":"post","pillar":"bread","campaign":"","topic":"Rye at dawn"},
		{"date":"2026-11-04","time":"10:00","platform":"facebook","format":"post","pillar":"Bread","campaign":"","topic":"Already on the calendar"},
		{"date":"2026-12-01","time":"10:00","platform":"facebook","format":"post","pillar":"Bread","campaign":"","topic":"Too late"}]}`}
	brain := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		var request map[string]any
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &request)
		asked = append(asked, request)
		answer := `{"kind":"failed","reason":"model_failed","error_name":"APIConnectionError"}`
		if len(answers) > 0 {
			answer, answers = answers[0], answers[1:]
		}
		io.WriteString(rw, answer)
	}))
	t.Cleanup(brain.Close)
	planner := &Planner{Pool: pool, Brain: brainclient.New(brain.URL, strings.Repeat("s", 40), 5*time.Second), Log: logging.New(io.Discard)}
	rome, _ := time.LoadLocation("Europe/Rome")
	now := time.Date(2026, 11, 2, 12, 0, 0, 0, time.UTC)
	if result, _ := planner.PlanTwoWeeks(ctx, company, owner, rome, now); result.Outcome != NoCurrentPlan || len(asked) != 0 {
		t.Fatalf("without a plan nobody is asked: %+v", result)
	}
	plan := &strategy.Plan{Summary: "A plan.", Pillars: []strategy.Pillar{{Name: "Bread", Description: "Baking.", ExampleTopics: []string{"Rye"}}},
		Campaigns: []strategy.Campaign{{Name: "Autumn", Objective: "Visits", Pillar: "Bread", Platforms: []string{"facebook"}, Timing: "Now", CallToAction: "Come"}},
		Cadence:   []strategy.Cadence{{Platform: "facebook", PostsPerWeek: 3, Formats: []string{"photo"}}}}
	plan.Audiences = []strategy.Audience{{Name: "a", Needs: "b", WhereToReach: "c"}}
	plan.Goals, plan.Positioning = []strategy.Goal{{Goal: "a", HowToMeasure: "b"}}, "p"
	plan.Pillars = append(plan.Pillars, strategy.Pillar{Name: "People", Description: "Us.", ExampleTopics: []string{"x"}}, strategy.Pillar{Name: "Town", Description: "Here.", ExampleTopics: []string{"y"}})
	plan.Statements, plan.MissingInformation, plan.Cautions = []strategy.Statement{{Text: "t", Basis: "suggestion", FactTopics: []string{}}}, []string{}, []string{}
	if _, outcome, err := strategy.SavePlan(ctx, pool, company, owner, strategy.NewPlan{Plan: plan, FactsUsed: []strategy.UsedFact{}}); err != nil || outcome != "saved" {
		t.Fatalf("a plan saved by a real owner's id: %s %v", outcome, err)
	}
	var existing string
	pool.QueryRow(ctx, `INSERT INTO content_drafts (company_id, platform, format, topic, status, planned_for, created_by_user_id, updated_by_user_id)
		VALUES ($1, 'facebook', 'post', 'Already on the calendar', 'idea', '2026-11-05T09:00:00Z', $2, $2) RETURNING id`, companyID, owner).Scan(&existing)
	result, err := planner.PlanTwoWeeks(ctx, company, owner, rome, now)
	if err != nil || result.Outcome != Planned2Weeks || result.Added != 1 {
		t.Fatalf("planned: %+v %v", result, err)
	}
	request, _ := json.Marshal(asked[0])
	for _, absent := range []string{companyID, owner, "facts", "Real Owner"} {
		if strings.Contains(string(request), absent) {
			t.Fatalf("the request holds %q: %s", absent, request)
		}
	}
	if dates := asked[0]["dates"].([]any); len(dates) != 14 || dates[0].(map[string]any)["date"] != "2026-11-03" || len(asked[0]["already_planned"].([]any)) != 1 {
		t.Fatalf("the days from tomorrow and what is planned then: %s", request)
	}
	var topic, status, pillar string
	var plannedFor time.Time
	var body string
	pool.QueryRow(ctx, `SELECT topic, status, pillar, planned_for, body FROM content_drafts WHERE company_id = $1 AND id <> $2`, companyID, existing).Scan(&topic, &status, &pillar, &plannedFor, &body)
	if topic != "Rye at dawn" || status != "idea" || pillar != "Bread" || body != "" || !plannedFor.Equal(time.Date(2026, 11, 4, 8, 30, 0, 0, time.UTC)) {
		t.Fatalf("an idea at the owner's local time: %s %s %s %v", topic, status, pillar, plannedFor)
	}
	var activity int
	pool.QueryRow(ctx, `SELECT count(*) FROM cofounder_activity WHERE company_id = $1 AND action = 'idea_planned' AND actor_user_id = $2`, companyID, owner).Scan(&activity)
	if activity != 1 {
		t.Fatal("each idea is in the activity log, by the real owner's id")
	}
	if result, _ := planner.PlanTwoWeeks(ctx, company, owner, rome, now); result.Outcome != NothingAdded || result.Problem != ProblemFailed {
		t.Fatalf("a failed answer adds nothing: %+v", result)
	}
	var pageID, postID string
	pool.QueryRow(ctx, `INSERT INTO social_connections (company_id, platform, external_account_id, display_name, account_kind, access_token_encrypted, connected_by_user_id)
		VALUES ($1, 'facebook', '111', 'Our Page', 'page', 'placeholder', $2) RETURNING id`, companyID, owner).Scan(&pageID)
	for _, status := range []string{"published", "canceled"} {
		pool.QueryRow(ctx, `INSERT INTO content_drafts (company_id, platform, format, topic, body, status, created_by_user_id, updated_by_user_id)
			VALUES ($1, 'facebook', 'post', $3, 'Text', 'published', $2, $2) RETURNING id`, companyID, owner, "Post "+status).Scan(&postID)
		_, err := pool.Exec(ctx, `INSERT INTO publish_jobs (company_id, draft_id, connection_id, scheduled_for, run_after, status, approval_mode, approved_version, created_by_user_id, attempts, published_at)
			VALUES ($1, $2, $3, $4::timestamptz - interval '3 hours', $4, $5, 'owner', 1, $6, 1, CASE WHEN $5 = 'published' THEN $4::timestamptz - interval '2 hours' END)`, companyID, postID, pageID, now, status, owner)
		if err != nil {
			t.Fatalf("a post: %v", err)
		}
	}
	page, err := ReadPage(ctx, pool, company, true, now)
	if err != nil || len(page.Items) != 3 || page.Items[0].Topic != "Post published" || *page.Items[0].AccountName != "Our Page" || !page.Items[0].At.Equal(now.Add(-2*time.Hour)) ||
		page.Items[1].Topic != "Rye at dawn" || page.Items[2].Kind != "draft" || page.PlanVersion == nil || *page.PlanVersion != 1 {
		t.Fatalf("the calendar: %+v %v", page, err)
	}
	pool.Exec(ctx, `UPDATE users SET role = 'member' WHERE company_id = $1`, companyID)
	if _, outcome, _ := SaveIdeas(ctx, pool, company, owner, []Idea{{Post: Post{Platform: "facebook", Format: "post", Topic: "x"}, PlannedFor: now}}); outcome != "not-allowed" {
		t.Fatalf("a member plans nothing: %s", outcome)
	}
}
