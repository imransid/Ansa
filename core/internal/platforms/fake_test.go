package platforms

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

// The settings of ansa's real apps. With any of them set, these tests
// refuse to run (as the old checks' local-only guard): a mistake must never
// reach a real platform. The network itself is refused too: every test
// answers through a fake platform.
var realAppSettings = []string{"LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "X_CLIENT_ID", "X_CLIENT_SECRET",
	"GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"}

func TestMain(m *testing.M) {
	for _, name := range realAppSettings {
		if os.Getenv(name) != "" {
			fmt.Println("platforms: tests refuse to run with " + name + " set (they must never reach a real platform)")
			os.Exit(1)
		}
	}
	http.DefaultTransport = refuseNetwork{}
	os.Exit(m.Run())
}

type refuseNetwork struct{}

func (refuseNetwork) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("tests never reach the network")
}

// recorded is one request the fake platform received.
type recorded struct {
	method, address string
	header          http.Header
	body            []byte
	hadTimeLimit    bool
}

// fakePlatform answers requests in order with its prepared answers and
// records each request.
type fakePlatform struct {
	mu       sync.Mutex
	answers  []func(*http.Request) (*http.Response, error)
	requests []recorded
}

func fake(answers ...func(*http.Request) (*http.Response, error)) *fakePlatform {
	return &fakePlatform{answers: answers}
}

func (f *fakePlatform) RoundTrip(r *http.Request) (*http.Response, error) {
	var body []byte
	if r.Body != nil {
		body, _ = io.ReadAll(r.Body)
	}
	_, hasDeadline := r.Context().Deadline()
	f.mu.Lock()
	f.requests = append(f.requests, recorded{method: r.Method, address: r.URL.String(), header: r.Header.Clone(), body: body, hadTimeLimit: hasDeadline})
	var next func(*http.Request) (*http.Response, error)
	if len(f.answers) > 0 {
		next, f.answers = f.answers[0], f.answers[1:]
	}
	f.mu.Unlock()
	if next == nil {
		return nil, errors.New("the fake platform has no answer left")
	}
	return next(r)
}

func (f *fakePlatform) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.requests)
}

// reply is a platform's answer: a status, a body and headers (name, value, ...).
func reply(status int, body string, headers ...string) func(*http.Request) (*http.Response, error) {
	return func(r *http.Request) (*http.Response, error) {
		header := http.Header{}
		for i := 0; i+1 < len(headers); i += 2 {
			header.Set(headers[i], headers[i+1])
		}
		return &http.Response{StatusCode: status, Header: header, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	}
}

// unreachable is a request that fails before any answer (its error names the token).
func unreachable(*http.Request) (*http.Response, error) {
	return nil, errors.New("dial tcp: no such host for member-token")
}

var testNow = time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)

// withApps is the door with every platform's app set, answering through f.
func withApps(f *fakePlatform) *Connectors {
	return &Connectors{Transport: f, Now: func() time.Time { return testNow }, Apps: map[string]App{
		"linkedin": {ClientID: "client-linkedin", ClientSecret: "app-secret-linkedin"},
		"x":        {ClientID: "client-x", ClientSecret: "app-secret-x"},
		"youtube":  {ClientID: "client-youtube", ClientSecret: "app-secret-youtube"},
	}}
}

const redirect = "https://app.ansa.test/api/social/callback-for-tests"

var (
	pngBytes = []byte("\x89PNG\r\n\x1a\nfake image bytes")
	mp4Bytes = []byte("\x00\x00\x00\x18ftypmp42 fake video")
)

func imagePost(text string) Post {
	return Post{Text: text, Media: &Media{Kind: "image", ContentType: "image/png", Bytes: pngBytes, AltText: "Three loaves"}}
}

func check(t *testing.T, what string, got, want any) {
	t.Helper()
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("%s:\n got %v\nwant %v", what, got, want)
	}
}

func everyRequestHadATimeLimit(t *testing.T, f *fakePlatform) {
	t.Helper()
	for _, request := range f.requests {
		if !request.hadTimeLimit {
			t.Fatalf("a request had no time limit: %s %s", request.method, request.address)
		}
	}
}
