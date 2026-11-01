package analytics

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/brainclient"
	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
)

// fakeBrain answers the review requests with scripted answers, in order,
// and keeps what it was sent. Never the real AI.
type fakeBrain struct {
	sent    []string
	answers []string
}

func (f *fakeBrain) reviewer(t *testing.T, pool *database.Pool, log *bytes.Buffer) *Reviewer {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		f.sent = append(f.sent, string(body))
		if len(f.answers) == 0 || r.URL.Path != "/v1/analytics/review" {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		io.WriteString(w, f.answers[0])
		f.answers = f.answers[1:]
	}))
	t.Cleanup(server.Close)
	return &Reviewer{Pool: pool, Limiter: ratelimit.New(pool, "analytics-test-secret-0000000000000"), Log: logging.New(log), Brain: brainclient.New(server.URL, "brain-secret", 5*time.Second)}
}

func answerJSON(review Review) string {
	encoded, _ := json.Marshal(map[string]any{"kind": "ok", "findings": review.Findings, "recommendations": review.Recommendations, "limits_of_this_data": review.Limits})
	return string(encoded)
}

// postsWithNumbers: P1..Pn as fivePosts (views 100 + 10i, reactions i + 4,
// the pillar on every other post), out in that order.
func (w *world) postsWithNumbers(count int, pillar string) []string {
	var ids []string
	for index := range count {
		postPillar := ""
		if index%2 == 0 {
			postPillar = pillar
		}
		id := w.post("linkedin", fmt.Sprintf("Post %d", index+1), postPillar, fmt.Sprintf("%d hours", 20-index))
		w.numbers(id, "dev_simulated", "1 minute", map[string]int64{"views": int64(100 + index*10), "reactions": int64(index + 4)})
		ids = append(ids, id)
	}
	return ids
}

func (w *world) forgetReviewCount(reviewer *Reviewer) {
	w.t.Cleanup(func() {
		w.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, reviewer.Limiter.Key("performance-reviews", w.company.String()))
	})
}

func TestNoReviewBelowFivePostsForAMemberPastTheLimitOrWithoutATimeZone(t *testing.T) {
	pool := database.ForTest(t)
	w := newWorld(t, pool)
	ctx := context.Background()
	brain := &fakeBrain{}
	reviewer := brain.reviewer(t, pool, &bytes.Buffer{})
	w.forgetReviewCount(reviewer)
	w.postsWithNumbers(4, "Behind the oven")
	w.post("linkedin", "No numbers", "", "1 hour")
	outcome, err := reviewer.Review(ctx, w.company, w.owner, true, "30", "Europe/Lisbon", time.Now())
	if err != nil || outcome.Code != TooFewPosts || outcome.Message != "A review needs at least 5 posts with numbers in the period, and it has 4: 1 more is needed. Nothing was sent to the AI." {
		t.Fatalf("too few: %+v %v", outcome, err)
	}
	w.postsWithNumbers(1, "Lunch ideas")
	if outcome, _ := reviewer.Review(ctx, w.company, w.owner, false, "30", "Europe/Lisbon", time.Now()); outcome.Message != "Only owners ask for a performance review." {
		t.Fatalf("a member: %+v", outcome)
	}
	for _, odd := range [][2]string{{"30", "Mars/Olympus"}, {"30", "Local"}, {"365", "Europe/Lisbon"}, {"30", ""}} {
		if outcome, _ := reviewer.Review(ctx, w.company, w.owner, true, odd[0], odd[1], time.Now()); outcome.Code != Invalid || !strings.Contains(outcome.Message, "timezone") {
			t.Fatalf("%v: %+v", odd, outcome)
		}
	}
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1 AND id = $2`, w.company.String(), w.owner)
	if saved, err := saveReview(ctx, pool, w.company, w.owner, periodBounds("30", time.Now()), fivePosts(), Review{}); saved || err != nil {
		t.Fatal("the role is read again inside the save: a member saves nothing")
	}
	w.must(`UPDATE users SET role = 'owner' WHERE company_id = $1 AND id = $2`, w.company.String(), w.owner)
	for range 10 {
		reviewer.Limiter.Over(ctx, "performance-reviews", w.company.String(), reviewsPerCompany)
	}
	if outcome, _ := reviewer.Review(ctx, w.company, w.owner, true, "30", "Europe/Lisbon", time.Now()); outcome.Code != Limited || !strings.Contains(outcome.Message, "a lot of reviews this hour") {
		t.Fatalf("past the limit: %+v", outcome)
	}
	if len(brain.sent) != 0 {
		t.Fatal("the brain was asked")
	}
}

func TestTheBrainGetsAggregatesOnlyAndTheCheckedReviewIsSaved(t *testing.T) {
	pool := database.ForTest(t)
	w, other := newWorld(t, pool), newWorld(t, pool)
	ctx := context.Background()
	jobIDs := w.postsWithNumbers(5, "Behind the oven")
	other.postsWithNumbers(5, "Their pillar")
	findings := []Finding{mostReactions, dropped[4], pillarAverage, quotedTopic}
	answer := Review{Findings: findings, Recommendations: []Recommendation{{Text: "Write more posts like P5.", BasedOn: []int{1, 3}}}, Limits: []string{"Only 5 posts had numbers in this period."}}
	brain := &fakeBrain{answers: []string{answerJSON(answer)}}
	reviewer := brain.reviewer(t, pool, &bytes.Buffer{})
	w.forgetReviewCount(reviewer)
	if outcome, err := reviewer.Review(ctx, w.company, w.owner, true, "30", "Asia/Kolkata", time.Now()); err != nil || outcome.Code != Saved {
		t.Fatalf("saved: %+v %v", outcome, err)
	}
	sent := brain.sent[0]
	for _, absent := range append([]string{"Bluebird Bakery", "Fresh from the oven", "Their pillar", "Kolkata", w.company.String(), w.owner, "dev-"}, jobIDs...) {
		if strings.Contains(sent, absent) {
			t.Fatalf("the brain got %q: %s", absent, sent)
		}
	}
	if !strings.Contains(sent, `"label":"P1","platform":"linkedin","format":"post","pillar":"Behind the oven","topic":"Post 1"`) ||
		!strings.Contains(sent, `"simulated":true,"numbers":{"reactions":4,"views":100}`) || !strings.Contains(sent, `"post_count":5`) || !strings.Contains(sent, `"posts_left_out":0`) {
		t.Fatalf("the posts as labeled: %s", sent)
	}
	var inputJSON, reviewJSON []byte
	var start, end time.Time
	pool.QueryRow(ctx, `SELECT input_summary, review, period_start, period_end FROM performance_reviews WHERE company_id = $1`, w.company.String()).Scan(&inputJSON, &reviewJSON, &start, &end)
	var stored Review
	json.Unmarshal(reviewJSON, &stored)
	want := Review{Findings: []Finding{mostReactions, pillarAverage, quotedTopic}, Recommendations: []Recommendation{{Text: "Write more posts like P5.", BasedOn: []int{1, 2}}}, Limits: answer.Limits}
	if fmt.Sprint(stored) != fmt.Sprint(want) || end.Sub(start) != 30*24*time.Hour {
		t.Fatalf("exactly what the check kept: %+v", stored)
	}
	var input ReviewInput
	json.Unmarshal(inputJSON, &input)
	if input.PostCount != 5 || !input.Simulated || input.TimeZone != "Asia/Kolkata" || input.Posts[4].Numbers["views"] != 140 || input.Groups[1].Name != "Behind the oven" {
		t.Fatalf("the input as sent, in the old keys: %s", inputJSON)
	}
	page, _ := ReadPage(ctx, pool, w.company, true, "30", time.Now())
	evidence := page.Review.Findings[0].Evidence[0]
	if !page.Review.Readable || !strings.HasPrefix(evidence.Source, "P5: “Post 5”, LinkedIn text post, ") || evidence.Metric != "Reactions" || evidence.Value != "8" || !evidence.Simulated {
		t.Fatalf("the newest review, each number in words: %+v", page.Review)
	}
	if page.Review.Findings[1].Evidence[0].Source != "G2: pillar “Behind the oven” (3 posts)" || page.Review.Findings[1].Evidence[0].Metric != "Views per post" {
		t.Fatalf("a group's number in words: %+v", page.Review.Findings[1])
	}
	if theirs, _ := ReadPage(ctx, pool, other.company, true, "30", time.Now()); theirs.Review != nil {
		t.Fatal("another company's review never shows")
	}
}

func TestNothingIsSavedWithoutACheckedFinding(t *testing.T) {
	pool := database.ForTest(t)
	w := newWorld(t, pool)
	ctx := context.Background()
	w.postsWithNumbers(5, "Behind the oven")
	allWrong := answerJSON(Review{Findings: dropped, Recommendations: []Recommendation{{Text: "Do more.", BasedOn: []int{1}}}, Limits: []string{"Few posts."}})
	brain := &fakeBrain{answers: []string{
		allWrong,
		`{"kind":"failed","reason":"unusable_answer"}`,
		`{"kind":"failed","reason":"model_unavailable"}`,
		`{"kind":"failed","reason":"model_failed","error_name":"InternalServerError"}`,
	}}
	log := &bytes.Buffer{}
	reviewer := brain.reviewer(t, pool, log)
	w.forgetReviewCount(reviewer)
	for _, want := range []string{allDropped, unusable, aiUnavailable, aiFailed, aiFailed} {
		if outcome, err := reviewer.Review(ctx, w.company, w.owner, true, "30", "Europe/Lisbon", time.Now()); err != nil || outcome.Code != NoReview || outcome.Message != want {
			t.Fatalf("want %q, got %+v %v", want, outcome, err)
		}
	}
	lines := log.String()
	if strings.Count(lines, `"msg":"claude call failed"`) != 2 || !strings.Contains(lines, `"code":"InternalServerError"`) || !strings.Contains(lines, `"code":"BrainUnavailable"`) {
		t.Fatalf("a failure logs its class only: %s", lines)
	}
	var reviews int
	pool.QueryRow(ctx, `SELECT count(*) FROM performance_reviews WHERE company_id = $1`, w.company.String()).Scan(&reviews)
	if page, _ := ReadPage(ctx, pool, w.company, true, "30", time.Now()); reviews != 0 || page.Review != nil {
		t.Fatal("nothing saved")
	}
}
