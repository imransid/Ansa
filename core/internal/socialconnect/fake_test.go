package socialconnect

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"

	"ansa/core/internal/platforms"
	"ansa/core/internal/tenant"
)

// With any setting of ansa's real platform apps set, these tests refuse to
// run: they must never reach a real platform (the old checks' local-only
// guard). LinkedIn, X and YouTube answer through a fake; Facebook through
// a local test server.
func TestMain(m *testing.M) {
	for _, name := range []string{"LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "X_CLIENT_ID", "X_CLIENT_SECRET",
		"GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"} {
		if os.Getenv(name) != "" {
			fmt.Println("socialconnect: tests refuse to run with " + name + " set (they must never reach a real platform)")
			os.Exit(1)
		}
	}
	os.Exit(m.Run())
}

// fakePlatform answers requests in order and records them (address and body).
type fakePlatform struct {
	mu       sync.Mutex
	answers  []string
	requests []string
}

func (f *fakePlatform) RoundTrip(r *http.Request) (*http.Response, error) {
	var body []byte
	if r.Body != nil {
		body, _ = io.ReadAll(r.Body)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.requests = append(f.requests, r.URL.String()+" "+string(body))
	if len(f.answers) == 0 {
		return nil, errors.New("the fake platform has no answer left")
	}
	next := f.answers[0]
	f.answers = f.answers[1:]
	status := 200
	if strings.HasPrefix(next, "400 ") {
		status, next = 400, strings.TrimPrefix(next, "400 ")
	}
	return &http.Response{StatusCode: status, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(next)), Request: r}, nil
}

func (f *fakePlatform) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.requests)
}

// What each platform answers a code and the account lookup.
var connects = map[string][]string{
	"linkedin": {`{"access_token":"li-access","expires_in":5184000,"scope":"openid,profile,w_member_social"}`, `{"sub":"abc123","name":"Ana Baker"}`},
	"x": {`{"expires_in":7200,"access_token":"x-access","refresh_token":"x-refresh","scope":"tweet.read tweet.write users.read offline.access media.write"}`,
		`{"data":{"id":"1234567890","name":"Ansa Bakery","username":"ansabakery"}}`},
	"youtube": {`{"access_token":"yt-access","expires_in":3599,"refresh_token":"yt-refresh","refresh_token_expires_in":604799,"scope":"https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly"}`,
		`{"items":[{"id":"UCabcdefghijklmnopqrstuv","snippet":{"title":"Ansa Bakery TV"}}]}`},
}

// withPlatforms gives the connector ansa's apps on LinkedIn, X and YouTube,
// answering through f.
func withPlatforms(c *Connector, f *fakePlatform) *Connector {
	c.Platforms = &platforms.Connectors{Transport: f, Apps: map[string]platforms.App{
		"linkedin": {ClientID: "client-linkedin", ClientSecret: "secret-linkedin"},
		"x":        {ClientID: "client-x", ClientSecret: "secret-x"},
		"youtube":  {ClientID: "client-youtube", ClientSecret: "secret-youtube"},
	}}
	return c
}

// connectFully starts and finishes one connection: the result code.
func connectFully(t *testing.T, c *Connector, company tenant.CompanyID, owner, platform string, f *fakePlatform) string {
	t.Helper()
	address, outcome, err := c.Start(context.Background(), company, owner, platform)
	if err != nil || outcome != "started" {
		t.Fatalf("start %s: %s %v", platform, outcome, err)
	}
	f.answers = append(f.answers, connects[platform]...)
	result, _, err := c.Complete(context.Background(), company, owner, true, platform, url.Values{"state": {queryOf(t, address).Get("state")}, "code": {"the-code"}})
	if err != nil {
		t.Fatalf("complete %s: %v", platform, err)
	}
	return result
}

func queryOf(t *testing.T, address string) url.Values {
	t.Helper()
	parsed, err := url.Parse(address)
	if err != nil {
		t.Fatalf("an address: %v", err)
	}
	return parsed.Query()
}

func check(t *testing.T, what string, got, want any) {
	t.Helper()
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("%s:\n got %v\nwant %v", what, got, want)
	}
}
