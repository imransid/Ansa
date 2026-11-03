package api

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/autopost"
	"ansa/core/internal/brainclient"
	"ansa/core/internal/logging"
)

// "Post one now" in Automatic goes out right after the answer, as the
// queue's "Publish now" does, not at the queue's next round.
func TestPostOneNowGoesOutRightAfterTheAnswer(t *testing.T) {
	w := newQueueWorld(t)
	brain := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, _ *http.Request) {
		io.WriteString(rw, `{"kind":"ok","body":"Come and see us this weekend.","call_to_action":"","hashtags":[]}`)
	}))
	t.Cleanup(brain.Close)
	server := w.serverAPI()
	server.Posts = &autopost.Writer{Pool: w.pool, Box: server.Box, Brain: brainclient.New(brain.URL, strings.Repeat("s", 40), 5*time.Second), Log: logging.New(io.Discard)}
	t.Cleanup(func() {
		keys := []string{server.Limiter.Key("settings-changes", w.owner), server.Limiter.Key("autopost-now", w.company.String())}
		w.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = ANY($1)`, keys)
	})
	w.must(`INSERT INTO assistant_settings (company_id, currency, time_zone, opening_hours) VALUES ($1, 'EUR', 'Europe/Rome', '{"mon":[],"tue":[],"wed":[],"thu":[],"fri":[],"sat":[],"sun":[]}')`, w.company.String())
	automatic := `{"enabled":true,"frequency":"three_a_week","time":"11:00","mode":"automatic","understood":true}`
	if code, answer := w.call("POST", "/api/v1/settings/posts", automatic, screensSecret, w.cookie); code != 200 {
		t.Fatalf("switched on: %d %v", code, answer)
	}
	if code, answer := w.call("POST", "/api/v1/settings/posts/now", "", screensSecret, w.cookie); code != 200 || answer["outcome"] != "scheduled" {
		t.Fatalf("post one now: %d %v", code, answer)
	}
	if w.sent != 1 || w.count(`SELECT count(*) FROM publish_jobs WHERE company_id = $1 AND status = 'published'`) != 1 {
		t.Fatalf("sent right after the answer: %d", w.sent)
	}
	_, page := w.call("GET", "/api/v1/settings/posts", "", screensSecret, w.cookie)
	if inner, _ := page["page"].(map[string]any); inner["isBusy"] != false {
		t.Fatalf("out: the page waits for nothing: %v", inner)
	}
}

func TestPostForMeThroughCoresAPI(t *testing.T) {
	w := newAPIWorld(t)
	code, answer := w.call("GET", "/api/v1/settings/posts", "", screensSecret, w.cookie)
	page := answer["page"].(map[string]any)
	if code != 200 || page["enabled"] != false || page["frequency"] != "three_a_week" || answer["canManage"] != true {
		t.Fatalf("the page: %d %v", code, answer)
	}
	automatic := `{"enabled":true,"frequency":"daily","time":"11:00","mode":"automatic","understood":false}`
	if code, answer := w.call("POST", "/api/v1/settings/posts", automatic, screensSecret, w.cookie); code != 400 || answer["fields"].(map[string]any)["understood"] == nil {
		t.Fatalf("Automatic needs the owner's tick: %d %v", code, answer)
	}
	understood := `{"enabled":true,"frequency":"daily","time":"11:00","mode":"automatic","understood":true}`
	if code, _ := w.call("POST", "/api/v1/settings/posts", understood, screensSecret, w.cookie); code != 409 {
		t.Fatalf("no time zone yet: %d", code)
	}
	w.must(`INSERT INTO assistant_settings (company_id, currency, time_zone, opening_hours) VALUES ($1, 'EUR', 'Europe/Rome', '{"mon":[],"tue":[],"wed":[],"thu":[],"fri":[],"sat":[],"sun":[]}')`, w.company.String())
	if code, answer := w.call("POST", "/api/v1/settings/posts", understood, screensSecret, w.cookie); code != 409 || !strings.Contains(answer["error"].(string), "Pro every day") {
		t.Fatalf("daily posts come with Pro (step 57; this is the free trial): %d %v", code, answer)
	}
	understood = strings.Replace(understood, `"daily"`, `"three_a_week"`, 1)
	if code, _ := w.call("POST", "/api/v1/settings/posts", understood, screensSecret, w.cookie); code != 200 {
		t.Fatalf("saved: %d", code)
	}
	if w.count(`SELECT count(*) FROM autopublish_rules WHERE company_id = $1 AND enabled`) != 1 {
		t.Fatal("the owner's Facebook rule is on")
	}
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1`, w.company.String())
	if code, _ := w.call("POST", "/api/v1/settings/posts", understood, screensSecret, w.cookie); code != 403 {
		t.Fatalf("members read only: %d", code)
	}
	if code, _ := w.call("POST", "/api/v1/settings/posts/now", "", screensSecret, w.cookie); code != 403 {
		t.Fatalf("members can't post: %d", code)
	}
}

func TestFacebookPagesThroughCoresAPI(t *testing.T) {
	w := newAPIWorld(t)
	if code, answer := w.call("POST", "/api/v1/social/facebook/connect", "", screensSecret, w.cookie); code != 409 || answer["error"] != "Facebook isn't set up on this development server: connect a stand-in account instead." {
		t.Fatalf("development without the app: %d %v", code, answer)
	}
	if code, _ := w.call("POST", "/api/v1/social/facebook/stand-in", "", screensSecret, w.cookie); code != 200 {
		t.Fatalf("stand-in: %d", code)
	}
	_, answer := w.call("GET", "/api/v1/social/facebook/callback?state=nobody&code=x", "", screensSecret, w.cookie)
	if answer["location"] != "/cofounder/accounts?result=expired_state&platform=facebook" {
		t.Fatalf("a return nobody started: %v", answer)
	}
	var id string
	w.pool.QueryRow(context.Background(), `SELECT id FROM social_connections WHERE company_id = $1`, w.company.String()).Scan(&id)
	if code, answer := w.call("POST", "/api/v1/social/connections/"+strings.ToUpper(id)+"/disconnect", "", screensSecret, w.cookie); code != 200 || answer["outcome"] != "disconnected" {
		t.Fatalf("disconnect: %d %v", code, answer)
	}
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1`, w.company.String())
	if code, _ := w.call("POST", "/api/v1/social/facebook/stand-in", "", screensSecret, w.cookie); code != 403 {
		t.Fatalf("members can't connect: %d", code)
	}
}
