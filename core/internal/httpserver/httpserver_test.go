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
