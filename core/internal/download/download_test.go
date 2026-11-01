package download

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

// fakeWeb answers by address, as the hosts would.
type fakeWeb map[string]*http.Response

func (f fakeWeb) RoundTrip(r *http.Request) (*http.Response, error) {
	if answer, known := f[r.URL.String()]; known {
		return answer, nil
	}
	return &http.Response{StatusCode: 404, Body: io.NopCloser(strings.NewReader(""))}, nil
}

func answer(status int, contentType, location, body string) *http.Response {
	header := http.Header{"Content-Type": {contentType}}
	if location != "" {
		header.Set("Location", location)
	}
	return &http.Response{StatusCode: status, Header: header, Body: io.NopCloser(strings.NewReader(body)), ContentLength: int64(len(body))}
}

func TestOnlyHttpsOnAnAllowedHostIsFetched(t *testing.T) {
	hosts := []string{"storage.vapi.ai"}
	for raw, want := range map[string]bool{
		"https://storage.vapi.ai/a.mp3":       true,
		"https://STORAGE.vapi.ai/a.mp3":       true,
		"http://storage.vapi.ai/a.mp3":        false,
		"https://storage.vapi.ai:8443/a.mp3":  false,
		"https://user:pw@storage.vapi.ai/a":   false,
		"https://storage.vapi.ai.evil.com/a":  false,
		"https://169.254.169.254/latest/meta": false,
	} {
		if Allowed(raw, hosts) != want {
			t.Errorf("%s: want %v", raw, want)
		}
	}
}

func TestEveryRedirectIsCheckedAgainAndTheTypeAndSizeHold(t *testing.T) {
	saved := Client
	t.Cleanup(func() { Client = saved })
	Client = &http.Client{CheckRedirect: saved.CheckRedirect, Transport: fakeWeb{
		"https://storage.vapi.ai/ok":      answer(200, "audio/mpeg; charset=x", "", "ID3"),
		"https://storage.vapi.ai/move":    answer(302, "", "/ok", ""),
		"https://storage.vapi.ai/escape":  answer(302, "", "https://internal.example/secret", ""),
		"https://storage.vapi.ai/page":    answer(200, "text/html", "", "<html>"),
		"https://storage.vapi.ai/too-big": answer(200, "audio/mpeg", "", strings.Repeat("x", 20)),
	}}
	rules := Rules{AllowedHosts: []string{"storage.vapi.ai"}, MaxBytes: 10, Timeout: time.Second,
		Accepts: func(contentType string) bool { return strings.HasPrefix(contentType, "audio/") }}
	ctx := context.Background()
	if data, contentType, _, ok := Fetch(ctx, "https://storage.vapi.ai/move", rules); !ok || string(data) != "ID3" || contentType != "audio/mpeg" {
		t.Fatalf("a redirect within the host: %q %q %v", data, contentType, ok)
	}
	if _, _, _, ok := Fetch(ctx, "https://storage.vapi.ai/escape", rules); ok {
		t.Fatal("a redirect to another host is refused")
	}
	if _, _, _, ok := Fetch(ctx, "https://storage.vapi.ai/page", rules); ok {
		t.Fatal("a type it doesn't accept is refused")
	}
	if _, _, tooLarge, ok := Fetch(ctx, "https://storage.vapi.ai/too-big", rules); ok || !tooLarge {
		t.Fatal("too large")
	}
}
