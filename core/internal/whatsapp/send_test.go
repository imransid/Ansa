package whatsapp

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ansa/core/internal/messenger"
)

const appSecret = "meta-app-secret-for-tests"

// fakeGraph answers each request with `answer(path, body)` (status, JSON)
// and keeps what it was sent (never Meta).
type fakeGraph struct {
	server   *httptest.Server
	requests []*http.Request
	bodies   []string
}

func newFakeGraph(t *testing.T, answer func(path, body string) (int, string)) *fakeGraph {
	g := &fakeGraph{}
	g.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		g.requests = append(g.requests, r)
		g.bodies = append(g.bodies, string(body))
		status, text := answer(r.URL.Path, string(body))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		io.WriteString(w, text)
	}))
	before := GraphURL
	GraphURL = g.server.URL
	t.Cleanup(func() {
		GraphURL = before
		g.server.Close()
	})
	return g
}

// A reply goes from the number with the token in a header (never the
// address) and appsecret_proof; a business-scoped id as "recipient", a
// number as "to".
func TestAReplyGoesFromTheNumber(t *testing.T) {
	graph := newFakeGraph(t, func(path, body string) (int, string) {
		return 200, `{"messaging_product":"whatsapp","messages":[{"id":"wamid.reply"}]}`
	})
	result := Send(context.Background(), appSecret, "106540352242922", "business-token", userID, "Yes, until 23:00.")
	if result != (Result{Status: "sent", ChannelMessageID: "wamid.reply"}) {
		t.Fatalf("sent: %+v", result)
	}
	request := graph.requests[0]
	if request.URL.Path != "/106540352242922/messages" || request.Header.Get("Authorization") != "Bearer business-token" ||
		request.URL.Query().Get("appsecret_proof") != messenger.AppSecretProof("business-token", appSecret) || strings.Contains(request.URL.RawQuery, "business-token") {
		t.Fatalf("the request: %s %s", request.URL, request.Header.Get("Authorization"))
	}
	var sent map[string]any
	json.Unmarshal([]byte(graph.bodies[0]), &sent)
	if sent["recipient"] != userID || sent["to"] != nil || sent["messaging_product"] != "whatsapp" {
		t.Fatalf("a business-scoped id goes as recipient: %s", graph.bodies[0])
	}
	Send(context.Background(), appSecret, "106540352242922", "business-token", "16315551181", "Hi")
	json.Unmarshal([]byte(graph.bodies[1]), &sent)
	if sent["to"] != "16315551181" {
		t.Fatalf("a number goes as to: %s", graph.bodies[1])
	}
}

// Meta's refusals become codes (its words are never read).
func TestARefusedReplySaysWhyAsACode(t *testing.T) {
	answers := map[string]Result{
		`{"error":{"code":131047,"message":"Re-engagement message"}}`:   {Status: "failed", Error: "reply_window_closed"},
		`{"error":{"code":130429,"message":"Rate limit hit"}}`:          {Status: "failed", Error: "rate_limited"},
		`{"error":{"code":190,"message":"Invalid OAuth access token"}}`: {Status: "failed", Error: "not_connected"},
		`{"error":{"code":131026,"message":"Message undeliverable"}}`:   {Status: "failed", Error: "refused"},
	}
	for answer, want := range answers {
		newFakeGraph(t, func(string, string) (int, string) { return 400, answer })
		if got := Send(context.Background(), appSecret, "1", "token", "16315551181", "Hi"); got != want {
			t.Fatalf("%s: %+v", answer, got)
		}
	}
	newFakeGraph(t, func(string, string) (int, string) { return 503, `{}` })
	if got := Send(context.Background(), appSecret, "1", "token", "16315551181", "Hi"); got != (Result{Status: "unclear", Error: "no_answer"}) {
		t.Fatalf("no answer: maybe sent, never sent again by itself: %+v", got)
	}
	graph := newFakeGraph(t, func(string, string) (int, string) { return 200, `{}` })
	if got := Send(context.Background(), appSecret, "1", "token", "16315551181", strings.Repeat("a", TextMax+1)); got.Error != "refused" || len(graph.requests) != 0 {
		t.Fatalf("too long for WhatsApp: refused before asking: %+v", got)
	}
}
