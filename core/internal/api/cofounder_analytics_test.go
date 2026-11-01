package api

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/analytics"
	"ansa/core/internal/brainclient"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
)

// postsWithNumbers: count stand-in LinkedIn posts that went out, P1..Pn
// with views 100 + 10i and reactions i + 4 (simulated).
func (w *apiWorld) postsWithNumbers(count int) {
	ctx := context.Background()
	owner := w.ownerID()
	var account string
	w.pool.QueryRow(ctx, `INSERT INTO social_connections (company_id, platform, external_account_id, display_name, account_kind, access_token_encrypted, connected_by_user_id, is_stand_in)
		VALUES ($1, 'linkedin', 'dev:stand-in', 'Development stand-in', 'member', 'placeholder', $2, true) RETURNING id`, w.company.String(), owner).Scan(&account)
	for index := range count {
		var draft, job string
		err := w.pool.QueryRow(ctx, `INSERT INTO content_drafts (company_id, platform, format, topic, body, status, created_by_user_id, updated_by_user_id)
			VALUES ($1, 'linkedin', 'post', $2, 'Fresh bread', 'published', $3, $3) RETURNING id`, w.company.String(), fmt.Sprintf("Post %d", index+1), owner).Scan(&draft)
		if err == nil {
			err = w.pool.QueryRow(ctx, `INSERT INTO publish_jobs (company_id, draft_id, connection_id, scheduled_for, run_after, status, approval_mode, approved_version, created_by_user_id, attempts, published_at, external_post_id)
				VALUES ($1, $2, $3, now(), now(), 'published', 'owner', 1, $4, 1, now() - make_interval(hours => $5), $6) RETURNING id`,
				w.company.String(), draft, account, owner, 20-index, "dev-"+draft).Scan(&job)
		}
		if err != nil {
			w.t.Fatalf("a post: %v", err)
		}
		w.must(`INSERT INTO post_metrics (company_id, publish_job_id, collected_at, views, reactions, source) VALUES ($1, $2, now(), $3, $4, 'dev_simulated')`,
			w.company.String(), job, 100+index*10, index+4)
	}
}

func TestAnalyticsAndAReviewThroughCoresAPI(t *testing.T) {
	w := newAPIWorld(t)
	brain := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		io.WriteString(rw, `{"kind":"ok","findings":[{"text":"P5 got the most reactions.","evidence":[{"post_label":"P5","group":"","metric":"reactions","value":8}]}],"recommendations":[],"limits_of_this_data":[]}`)
	}))
	t.Cleanup(brain.Close)
	limiter := ratelimit.New(w.pool, authSecret)
	w.serverAPI().Reviews = &analytics.Reviewer{Pool: w.pool, Limiter: limiter, Log: logging.New(io.Discard), Brain: brainclient.New(brain.URL, "brain-secret", 5*time.Second)}
	t.Cleanup(func() {
		w.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, limiter.Key("performance-reviews", w.company.String()))
	})
	review := `{"period":"30","timeZone":"Europe/Lisbon"}`
	if code, answer := w.call("POST", "/api/v1/cofounder/analytics/review", review, screensSecret, w.cookie); code != 409 || !strings.HasPrefix(answer["error"].(string), "A review needs at least 5 posts") {
		t.Fatalf("too few posts: %d %v", code, answer)
	}
	w.postsWithNumbers(5)
	code, page := w.call("GET", "/api/v1/cofounder/analytics?period=7", "", screensSecret, w.cookie)
	if code != 200 || page["period"] != "7" || page["postCount"] != 5.0 || page["postsWithNumbers"] != 5.0 || page["canReview"] != true || page["review"] != nil {
		t.Fatalf("the page: %d %v", code, page)
	}
	if _, page := w.call("GET", "/api/v1/cofounder/analytics?period=365", "", screensSecret, w.cookie); page["period"] != "30" {
		t.Fatal("an odd period is 30 days")
	}
	if code, _ := w.call("POST", "/api/v1/cofounder/analytics/review", `{"period":"30","timeZone":"Europe/Lisbon","companyId":"x"}`, screensSecret, w.cookie); code != 400 {
		t.Fatal("an unknown field is refused: the company comes from the session")
	}
	if code, answer := w.call("POST", "/api/v1/cofounder/analytics/review", `{"period":"30","timeZone":"Mars/Olympus"}`, screensSecret, w.cookie); code != 400 || !strings.Contains(answer["error"].(string), "timezone") {
		t.Fatalf("an unknown time zone: %d %v", code, answer)
	}
	if code, answer := w.call("POST", "/api/v1/cofounder/analytics/review", review, screensSecret, w.cookie); code != 200 || answer["outcome"] != "saved" {
		t.Fatalf("saved: %d %v", code, answer)
	}
	_, page = w.call("GET", "/api/v1/cofounder/analytics", "", screensSecret, w.cookie)
	shown := page["review"].(map[string]any)
	finding := shown["findings"].([]any)[0].(map[string]any)
	if shown["readable"] != true || finding["text"] != "P5 got the most reactions." || finding["evidence"].([]any)[0].(map[string]any)["value"] != "8" {
		t.Fatalf("the newest review: %v", shown)
	}
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1`, w.company.String())
	if code, answer := w.call("POST", "/api/v1/cofounder/analytics/review", review, screensSecret, w.cookie); code != 403 || answer["error"] != "Only owners ask for a performance review." {
		t.Fatalf("members read only: %d %v", code, answer)
	}
	if _, page := w.call("GET", "/api/v1/cofounder/analytics", "", screensSecret, w.cookie); page["canReview"] != false || page["review"] == nil {
		t.Fatal("a member reads the page and the review, without the button")
	}
}
