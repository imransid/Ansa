package autopost

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/secure"
	"ansa/core/internal/social"
	"ansa/core/internal/tenant"
)

const week = `{"mon":[{"opens":"12:00","closes":"23:00"}],"tue":[],"wed":[],"thu":[],"fri":[],"sat":[],"sun":[]}`

type postWorld struct {
	pool    *database.Pool
	company tenant.CompanyID
	owner   string
	writer  *Writer
	answers []string
	asked   []map[string]any
}

func newPostWorld(t *testing.T) *postWorld {
	t.Helper()
	w := &postWorld{pool: database.ForTest(t)}
	companyID := database.TestCompany(t, w.pool)
	w.company, _ = tenant.FromTrustedSource(companyID)
	w.owner = database.TestOwner(t, w.pool, companyID)
	ctx := context.Background()
	box, _ := secure.NewBox("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	brain := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		var request map[string]any
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &request)
		w.asked = append(w.asked, request)
		answer := `{"kind":"failed","reason":"model_failed","error_name":"APITimeoutError"}`
		if len(w.answers) > 0 {
			answer, w.answers = w.answers[0], w.answers[1:]
		}
		rw.Header().Set("Content-Type", "application/json")
		io.WriteString(rw, answer)
	}))
	t.Cleanup(brain.Close)
	w.writer = &Writer{Pool: w.pool, Box: box, Brain: brainclient.New(brain.URL, strings.Repeat("s", 40), 5*time.Second), Log: logging.New(io.Discard)}
	steps := []string{
		`UPDATE companies SET name = 'Luigi''s', business_type = 'restaurant' WHERE id = $1`,
		`INSERT INTO assistant_settings (company_id, currency, time_zone, opening_hours, instructions) VALUES ($1, 'EUR', 'Europe/Rome', '` + week + `'::jsonb, 'Family run.')`,
		`INSERT INTO catalog_items (company_id, category, name, description, price_cents, position) VALUES ($1, 'Pizza', 'Margherita', 'Tomato and mozzarella', 950, 1)`,
	}
	for _, step := range steps {
		if _, err := w.pool.Exec(ctx, step, companyID); err != nil {
			t.Fatalf("setup: %v", err)
		}
	}
	var pageID string
	w.pool.QueryRow(ctx, `INSERT INTO social_connections (company_id, platform, external_account_id, display_name, account_kind, access_token_encrypted, connected_by_user_id, is_stand_in)
		VALUES ($1, 'facebook', 'dev:stand-in', 'Luigi''s Page', 'page', 'placeholder', $2, true) RETURNING id`, companyID, w.owner).Scan(&pageID)
	token, _ := box.Encrypt("dev-token", social.TokenContext(w.company, pageID, "access"))
	w.pool.Exec(ctx, `UPDATE social_connections SET access_token_encrypted = $3 WHERE company_id = $1 AND id = $2`, companyID, pageID, token)
	return w
}

func (w *postWorld) count(t *testing.T, statement string) int {
	var n int
	if err := w.pool.QueryRow(context.Background(), statement, w.company.String()).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

var tuesdayNoon = time.Date(2026, 11, 3, 11, 0, 0, 0, time.UTC)

func TestAutomaticWritesTheNextPostOnceAndQueuesItUnderTheOwnersRule(t *testing.T) {
	w := newPostWorld(t)
	ctx := context.Background()
	if outcome, err := Save(ctx, w.pool, w.company, w.owner, Choices{Enabled: true, Frequency: FrequencyThreeAWeek, Clock: "11:00", Mode: "automatic"}); err != nil || outcome != "saved" {
		t.Fatalf("save: %s %v", outcome, err)
	}
	if w.count(t, `SELECT count(*) FROM autopublish_rules WHERE company_id = $1 AND platform = 'facebook' AND pillar = '' AND enabled`) != 1 {
		t.Fatal("Automatic switches the owner's Facebook rule on")
	}
	w.answers = []string{`{"kind":"ok","body":"Our Margherita is €9.50 tomorrow too.","call_to_action":"Book a table","hashtags":["pizza"]}`}
	if written, err := w.writer.RunDue(ctx, w.company.String(), tuesdayNoon); err != nil || written != 1 {
		t.Fatalf("run: %d %v", written, err)
	}
	asked := w.asked[0]
	offers, _ := json.Marshal(asked["offers"])
	post := asked["post"].(map[string]any)
	if !strings.Contains(string(offers), "Margherita | €9.50 | Tomato and mozzarella") || post["day"] != "Wednesday 2026-11-04" || post["topic"] != "Margherita" || asked["company_id"] != nil {
		t.Fatalf("the brain got the business's own details only: %v", asked)
	}
	// The brain reads every list strictly: null (no words to avoid here) is
	// refused, and the post was never written (found in step 58's demo).
	for _, list := range []string{"hours", "offers", "words_to_avoid", "recent_posts"} {
		if _, isList := asked[list].([]any); !isList {
			t.Fatalf("%s must be a list, never null: %v", list, asked[list])
		}
	}
	var scheduledFor time.Time
	var mode string
	w.pool.QueryRow(ctx, `SELECT scheduled_for, approval_mode FROM publish_jobs WHERE company_id = $1`, w.company.String()).Scan(&scheduledFor, &mode)
	if mode != "auto_rule" || !scheduledFor.Equal(time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC)) {
		t.Fatalf("queued for Wednesday 11:00 in Rome: %v %s", scheduledFor, mode)
	}
	if written, _ := w.writer.RunDue(ctx, w.company.String(), tuesdayNoon); written != 0 || len(w.asked) != 1 {
		t.Fatal("a posting time is written once")
	}
	if outcome, _ := Save(ctx, w.pool, w.company, w.owner, Choices{Enabled: false, Frequency: FrequencyThreeAWeek, Clock: "11:00", Mode: "automatic"}); outcome != "saved" {
		t.Fatal("switch off")
	}
	if w.count(t, `SELECT count(*) FROM publish_jobs WHERE company_id = $1 AND status = 'canceled'`) != 1 ||
		w.count(t, `SELECT count(*) FROM autopost_slots WHERE company_id = $1 AND skip_reason = 'stopped'`) != 1 ||
		w.count(t, `SELECT count(*) FROM autopublish_rules WHERE company_id = $1 AND enabled`) != 0 {
		t.Fatal("switched off: the post taken back, the rule off")
	}
}

func TestAMadeUpPriceIsTriedOnceMoreThenSkipped(t *testing.T) {
	w := newPostWorld(t)
	ctx := context.Background()
	// Daily posts come with Pro (step 57).
	w.pool.Exec(ctx, `INSERT INTO company_billing (company_id, stripe_customer_id, stripe_subscription_id, status, package) VALUES ($1, $2, $3, 'active', 'pro')`,
		w.company.String(), "cus_"+w.company.String(), "sub_"+w.company.String())
	Save(ctx, w.pool, w.company, w.owner, Choices{Enabled: true, Frequency: FrequencyDaily, Clock: "11:00", Mode: "automatic"})
	madeUp := `{"kind":"ok","body":"Margherita for only €5 today!","call_to_action":"","hashtags":[]}`
	w.answers = []string{madeUp, madeUp}
	w.writer.RunDue(ctx, w.company.String(), tuesdayNoon)
	first, second := w.asked[0]["post"].(map[string]any), w.asked[1]["post"].(map[string]any)
	if len(w.asked) != 2 || first["kind_label"] == second["kind_label"] {
		t.Fatalf("the second try is another kind of post: %v / %v", first, second)
	}
	if w.count(t, `SELECT count(*) FROM autopost_slots WHERE company_id = $1 AND skip_reason = 'checks_failed' AND attempts = 2`) != 1 ||
		w.count(t, `SELECT count(*) FROM content_drafts WHERE company_id = $1`) != 0 {
		t.Fatal("skipped, nothing saved")
	}
}

func TestAskMeFirstWaitsForTheOwnerAndNoAIIsSaid(t *testing.T) {
	w := newPostWorld(t)
	ctx := context.Background()
	if outcome, _ := w.writer.PostNow(ctx, w.company, tuesdayNoon); outcome.Outcome != "not-on" {
		t.Fatal("off: nothing is written")
	}
	Save(ctx, w.pool, w.company, w.owner, Choices{Enabled: true, Frequency: FrequencyWeekly, Clock: "18:30", Mode: "ask_first"})
	w.answers = []string{`{"kind":"ok","body":"Come and see us this weekend.","call_to_action":"","hashtags":[]}`}
	if outcome, err := w.writer.PostNow(ctx, w.company, tuesdayNoon); err != nil || outcome.Outcome != SlotWaitingApproval {
		t.Fatalf("ask first: %+v %v", outcome, err)
	}
	if w.count(t, `SELECT count(*) FROM content_drafts WHERE company_id = $1 AND status = 'draft' AND generated_version = 1`) != 1 ||
		w.count(t, `SELECT count(*) FROM publish_jobs WHERE company_id = $1`) != 0 ||
		w.count(t, `SELECT count(*) FROM autopublish_rules WHERE company_id = $1 AND enabled`) != 0 {
		t.Fatal("a draft waits for the owner; nothing queued, no rule on")
	}
	w.answers = []string{`{"kind":"failed","reason":"model_unavailable"}`}
	if outcome, _ := w.writer.PostNow(ctx, w.company, tuesdayNoon.Add(time.Second)); outcome.Outcome != SlotSkipped ||
		w.count(t, `SELECT count(*) FROM autopost_slots WHERE company_id = $1 AND skip_reason = 'no_ai'`) != 1 {
		t.Fatal("no AI set up: skipped and said")
	}
	// Weekly: the next 15 days hold two Fridays (as the old page showed).
	page, err := ReadPage(ctx, w.pool, w.company, tuesdayNoon)
	if err != nil || !page.Enabled || len(page.Pages) != 1 || len(page.NextTimes) != 2 || len(page.Slots) != 2 {
		t.Fatalf("page: %+v %v", page, err)
	}
}
