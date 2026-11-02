package api

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/assistant"
	"ansa/core/internal/brainclient"
	"ansa/core/internal/chat"
	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/phone"
	"ansa/core/internal/session"
)

// The practice phone: an owner calls their own ansa through the API (typed
// words here; the page also sends recordings); a member, and any production
// server, are refused.
func TestThePracticePhoneIsAnOwnersDevelopmentTool(t *testing.T) {
	w := newAPIWorld(t)
	brain := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		rw.Header().Set("Content-Type", "application/json")
		io.WriteString(rw, `{"kind":"reply","text":"Yes, we're open until 23:00."}`)
	}))
	t.Cleanup(brain.Close)
	runner := &assistant.Runner{Pool: w.pool, Box: w.api.Box, Limiter: w.api.Limiter, Log: logging.New(io.Discard),
		Brain: brainclient.New(brain.URL, strings.Repeat("s", 40), 5*time.Second), Chat: &chat.Sender{}}
	w.api.Phone = &phone.Service{Pool: w.pool, Box: w.api.Box, Assistant: runner, Log: logging.New(io.Discard)}
	t.Cleanup(func() {
		ctx := context.Background()
		w.pool.Exec(ctx, `DELETE FROM rate_limits WHERE key = ANY($1)`, []string{
			w.api.Limiter.Key("practice-calls", w.company.String()), w.api.Limiter.Key("practice-turns", w.company.String()),
			w.api.Limiter.Key("assistant-replies", w.company.String())})
	})

	if code, page := w.call("GET", "/api/v1/phone/practice", "", screensSecret, w.cookie); code != 200 || page["available"] != true {
		t.Fatalf("an owner on a development server may: %d %v", code, page)
	}
	code, started := w.call("POST", "/api/v1/phone/practice/start", `{"callerName":"Lena","callerNumber":"+39 333 123 4567"}`, screensSecret, w.cookie)
	if code != 200 || !strings.HasPrefix(started["words"].([]any)[0].(string), "Hello! I'm the AI assistant for") {
		t.Fatalf("picked up: %d %v", code, started)
	}
	callID := started["callId"].(string)
	callKey := w.api.Limiter.Key("assistant-call", started["conversationId"].(string))
	w.must(`DELETE FROM rate_limits WHERE key = $1`, callKey)
	t.Cleanup(func() { w.pool.Exec(context.Background(), `DELETE FROM rate_limits WHERE key = $1`, callKey) })
	code, turn := w.call("POST", "/api/v1/phone/practice/turn", `{"callId":"`+callID+`","text":"Are you open tonight?"}`, screensSecret, w.cookie)
	if code != 200 || turn["heard"] != "Are you open tonight?" || turn["words"].([]any)[0] != "Yes, we're open until 23:00." {
		t.Fatalf("a turn: %d %v", code, turn)
	}
	if code, _ := w.call("POST", "/api/v1/phone/practice/turn", `{"callId":"`+callID+`","audio":"AAAA","language":"xx"}`, screensSecret, w.cookie); code != 400 {
		t.Fatalf("a language the brain doesn't hear: %d", code)
	}
	if code, _ := w.call("POST", "/api/v1/phone/practice/start", `{"callerName":"x","callerNumber":"12"}`, screensSecret, w.cookie); code != 400 {
		t.Fatalf("a number too short: %d", code)
	}
	if code, _ := w.call("POST", "/api/v1/phone/practice/end", `{"callId":"`+callID+`"}`, screensSecret, w.cookie); code != 200 {
		t.Fatalf("hang up: %d", code)
	}
	if code, _ := w.call("POST", "/api/v1/phone/practice/turn", `{"callId":"`+callID+`","text":"Hello?"}`, screensSecret, w.cookie); code != 409 {
		t.Fatalf("an ended call: %d", code)
	}

	member := database.TestOwner(t, w.pool, w.company.String())
	w.must(`UPDATE users SET role = 'member' WHERE company_id = $1 AND id = $2`, w.company.String(), member)
	token, _ := conversations.NewID()
	w.must(`INSERT INTO sessions (id, token, expires_at, user_id) VALUES ($1, $1, now() + interval '1 day', $2)`, token, member)
	t.Cleanup(func() { w.pool.Exec(context.Background(), `DELETE FROM sessions WHERE token = $1`, token) })
	memberCookie := "better-auth.session_token=" + session.SignValue(token, authSecret)
	if code, _ := w.call("POST", "/api/v1/phone/practice/start", `{"callerName":"Lena","callerNumber":"+39 333 123 4567"}`, screensSecret, memberCookie); code != 403 {
		t.Fatalf("a member can't: %d", code)
	}
	w.api.Development = false
	if code, answer := w.call("POST", "/api/v1/phone/practice/start", `{"callerName":"Lena","callerNumber":"+39 333 123 4567"}`, screensSecret, w.cookie); code != 403 || answer["error"] != practiceOnly {
		t.Fatalf("never on a production server: %d %v", code, answer)
	}
}
