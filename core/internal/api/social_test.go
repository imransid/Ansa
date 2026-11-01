package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"ansa/core/internal/logging"
	"ansa/core/internal/platforms"
)

// fakeX answers X's requests in order and records them; never a network.
type fakeX struct {
	mu       sync.Mutex
	answers  []string
	requests []string
}

func (f *fakeX) RoundTrip(r *http.Request) (*http.Response, error) {
	body, _ := io.ReadAll(r.Body)
	f.mu.Lock()
	defer f.mu.Unlock()
	f.requests = append(f.requests, r.URL.String()+" "+string(body))
	if len(f.answers) == 0 {
		return nil, errors.New("no answer left")
	}
	next := f.answers[0]
	f.answers = f.answers[1:]
	return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(next)), Request: r}, nil
}

func (f *fakeX) seen() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string{}, f.requests...)
}

func TestLinkedInXAndYouTubeAccountsThroughCoresAPI(t *testing.T) {
	w := newAPIWorld(t)
	var owner string
	w.pool.QueryRow(context.Background(), `SELECT id FROM users WHERE company_id = $1`, w.company.String()).Scan(&owner)
	t.Cleanup(func() {
		w.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, w.api.Limiter.Key("social-accounts", owner))
	})
	var lines bytes.Buffer
	w.api.Log = logging.New(&lines)
	x := &fakeX{}
	w.api.Social.Platforms = &platforms.Connectors{Development: true, Transport: x, Apps: map[string]platforms.App{"x": {ClientID: "client-x", ClientSecret: "secret-x"}}}
	code, answer := w.call("POST", "/api/v1/social/x/connect", "", screensSecret, w.cookie)
	address, _ := url.Parse(answer["url"].(string))
	if code != 200 || address.Host != "x.com" || address.Query().Get("code_challenge_method") != "S256" {
		t.Fatalf("X's consent screen: %d %v", code, answer)
	}
	x.answers = []string{`{"expires_in":7200,"access_token":"x-access","refresh_token":"x-refresh"}`, `{"data":{"id":"1234567890","name":"Ansa Bakery","username":"ansabakery"}}`}
	_, answer = w.call("GET", "/api/v1/social/x/callback?state="+address.Query().Get("state")+"&code=the-code", "", screensSecret, w.cookie)
	if answer["location"] != "/cofounder/accounts?result=connected&platform=x" {
		t.Fatalf("connected: %v", answer)
	}
	start, _ := w.call("POST", "/api/v1/social/x/connect", "", screensSecret, w.cookie)
	denied := url.Values{"error": {"access_denied"}, "error_description": {"x-access"}}
	_, answer = w.call("GET", "/api/v1/social/x/callback?state=made-up&"+denied.Encode(), "", screensSecret, w.cookie)
	if start != 200 || answer["location"] != "/cofounder/accounts?result=expired_state&platform=x" {
		t.Fatalf("a return nobody started: %v", answer)
	}
	code, answer = w.call("GET", "/api/v1/cofounder/accounts", "", screensSecret, w.cookie)
	page, _ := json.Marshal(answer)
	if code != 200 || !strings.Contains(string(page), `"displayName":"Ansa Bakery (@ansabakery)"`) || !strings.Contains(string(page), `"mode":"stand-in"`) {
		t.Fatalf("the Accounts page: %d %s", code, page)
	}
	var id string
	w.pool.QueryRow(context.Background(), `SELECT id FROM social_connections WHERE company_id = $1 AND platform = 'x'`, w.company.String()).Scan(&id)
	x.mu.Lock()
	x.answers = []string{`{}`, `{}`}
	x.mu.Unlock()
	if code, answer := w.call("POST", "/api/v1/social/connections/"+id+"/disconnect", "", screensSecret, w.cookie); code != 200 || answer["outcome"] != "disconnected" {
		t.Fatalf("disconnect: %d %v", code, answer)
	}
	// After the answer, X is asked to take back the refresh token, then the access token.
	for deadline := time.Now().Add(3 * time.Second); len(x.seen()) < 4 && time.Now().Before(deadline); {
		time.Sleep(20 * time.Millisecond)
	}
	revokes := x.seen()
	if len(revokes) != 4 || !strings.Contains(revokes[2], "/2/oauth2/revoke token=x-refresh") || !strings.Contains(revokes[3], "token=x-access") {
		t.Fatalf("revoked after the answer: %v", revokes)
	}
	for _, secret := range []string{"x-access", "x-refresh", "the-code", "secret-x", address.Query().Get("state")} {
		if strings.Contains(string(page), secret) || strings.Contains(lines.String(), secret) {
			t.Fatalf("%s reached the page or the logs", secret)
		}
	}
	if code, answer := w.call("POST", "/api/v1/social/youtube/connect", "", screensSecret, w.cookie); code != 409 || answer["error"] != "YouTube isn't set up on this development server: connect a stand-in account instead." {
		t.Fatalf("YouTube without ansa's app: %d %v", code, answer)
	}
	if code, _ := w.call("POST", "/api/v1/social/youtube/stand-in", "", screensSecret, w.cookie); code != 200 {
		t.Fatalf("YouTube's stand-in: %d", code)
	}
	for _, path := range []string{"/api/v1/social/myspace/connect", "/api/v1/social/myspace/stand-in"} {
		if code, _ := w.call("POST", path, "", screensSecret, w.cookie); code != 404 {
			t.Fatalf("%s: %d", path, code)
		}
	}
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1`, w.company.String())
	if code, answer := w.call("GET", "/api/v1/cofounder/accounts", "", screensSecret, w.cookie); code != 200 || answer["page"].(map[string]any)["canManage"] != false {
		t.Fatalf("members read the page: %d", code)
	}
	if code, _ := w.call("POST", "/api/v1/social/x/connect", "", screensSecret, w.cookie); code != 403 {
		t.Fatalf("members can't connect: %d", code)
	}
}
