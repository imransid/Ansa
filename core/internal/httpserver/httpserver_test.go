package httpserver

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ansa/core/internal/logging"
)

func TestEveryAnswerHasTheSecurityHeadersAndAPanicIsA500(t *testing.T) {
	var logs bytes.Buffer
	routes := http.NewServeMux()
	routes.HandleFunc("GET /health", Health)
	routes.HandleFunc("GET /boom", func(http.ResponseWriter, *http.Request) { panic("secret detail") })
	server := New("127.0.0.1:0", routes, logging.New(&logs))

	ok := httptest.NewRecorder()
	server.Handler.ServeHTTP(ok, httptest.NewRequest(http.MethodGet, "/health", nil))
	if ok.Code != 200 || ok.Header().Get("X-Content-Type-Options") != "nosniff" || ok.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("health: %d %v", ok.Code, ok.Header())
	}
	boom := httptest.NewRecorder()
	server.Handler.ServeHTTP(boom, httptest.NewRequest(http.MethodGet, "/boom", nil))
	if boom.Code != 500 || strings.Contains(logs.String(), "secret detail") {
		t.Fatalf("panic: %d, log %s", boom.Code, logs.String())
	}
}

func TestReadBodyRefusesMoreThanItsCap(t *testing.T) {
	small := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader("hello"))
	if body, err := ReadBody(small, 5); err != nil || string(body) != "hello" {
		t.Fatalf("got %q, %v", body, err)
	}
	big := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader("hello!"))
	if _, err := ReadBody(big, 5); err != ErrTooLarge {
		t.Fatalf("expected ErrTooLarge, got %v", err)
	}
}

func TestClientIPCountsAsTheOldBackendDoes(t *testing.T) {
	cases := map[string]string{
		"203.0.113.5, 10.0.0.1": "203.0.113.5",
		"2001:0DB8:1:2:3:4:5:6": "2001:db8:1:2::/64",
		"2001:db8::1":           "2001:db8:0:0::/64",
		"fe80::1%eth0":          "fe80:0:0:0::/64",
		"::1":                   "::1",
		"::ffff:203.0.113.5":    "::ffff:203.0.113.5",
		"not an address":        "not an address",
	}
	for forwarded, want := range cases {
		r := httptest.NewRequest(http.MethodPost, "/", nil)
		r.Header.Set("X-Forwarded-For", forwarded)
		if got := ClientIP(r); got != want {
			t.Errorf("ClientIP(%q) = %q, want %q", forwarded, got, want)
		}
	}
	r := httptest.NewRequest(http.MethodPost, "/", nil)
	r.RemoteAddr = "198.51.100.9:1234"
	if got := ClientIP(r); got != "198.51.100.9" {
		t.Errorf("without a proxy header: %q", got)
	}
}
