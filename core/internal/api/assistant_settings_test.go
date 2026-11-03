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
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/secure"
)

func TestSettingsAssistantAndTheTryBox(t *testing.T) {
	w := newAPIWorld(t)
	ctx := context.Background()
	code, answer := w.call("GET", "/api/v1/settings/assistant", "", screensSecret, w.cookie)
	if code != 200 || answer["settings"].(map[string]any)["replyMode"] != "automatic" || answer["engineState"].(map[string]any)["keySource"] != "none" {
		t.Fatalf("defaults: %d %v", code, answer)
	}
	code, answer = w.call("POST", "/api/v1/settings/assistant", `{"status":"on","replyMode":"ask_first","instructions":"","holdingReply":"  ","alertByEmail":true}`, screensSecret, w.cookie)
	if code != 400 || answer["fields"].(map[string]any)["holdingReply"] != "Write what people get while you take over." {
		t.Fatalf("an empty holding reply: %d %v", code, answer)
	}
	if code, _ := w.call("POST", "/api/v1/settings/assistant", `{"status":"on","replyMode":"ask_first","instructions":"Be brief.","holdingReply":"We'll be right with you.","alertByEmail":false}`, screensSecret, w.cookie); code != 200 {
		t.Fatalf("saved: %d", code)
	}
	key := "sk-ant-" + strings.Repeat("a", 30) + "wxyz"
	if code, _ := w.call("POST", "/api/v1/settings/assistant/engine", `{"engine":"api_key","apiKey":"`+key+`","removeKey":false}`, screensSecret, w.cookie); code != 200 {
		t.Fatalf("own key: %d", code)
	}
	var stored, hint string
	w.pool.QueryRow(ctx, `SELECT anthropic_key_encrypted, anthropic_key_hint FROM assistant_settings WHERE company_id = $1`, w.company.String()).Scan(&stored, &hint)
	if hint != "wxyz" || strings.Contains(stored, "sk-ant") {
		t.Fatalf("stored encrypted, shown by its last four only: %q", hint)
	}
	if code, _ := w.call("GET", "/api/v1/settings/assistant", "", screensSecret, w.cookie); code != 200 {
		t.Fatal("read again")
	}
	if code, answer := w.call("POST", "/api/v1/settings/assistant/engine", `{"engine":"claude_code"}`, screensSecret, w.cookie); code != 400 || !strings.Contains(answer["error"].(string), "only be used while developing") {
		t.Fatalf("Claude Code needs the brain's say-so: %d %v", code, answer)
	}
	code, answer = w.call("POST", "/api/v1/settings/assistant/away", `{"timeZone":"Mars/Base","hours":{"mon":[{"opens":"18:00","closes":"02:00"}]},"replyGraceMinutes":7}`, screensSecret, w.cookie)
	fields, _ := answer["fields"].(map[string]any)
	if code != 400 || fields["timeZone"] == nil || fields["mon"] == nil || fields["replyGraceMinutes"] == nil {
		t.Fatalf("away problems: %d %v", code, answer)
	}
	if code, _ := w.call("POST", "/api/v1/settings/assistant/away", `{"timeZone":"Europe/Rome","hours":{"mon":[{"opens":"18:00","closes":"00:00"}]},"replyGraceMinutes":10}`, screensSecret, w.cookie); code != 200 {
		t.Fatal("away hours saved")
	}

	brain := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		io.WriteString(rw, `{"kind":"reply","text":"Yes, we're open."}`)
	}))
	defer brain.Close()
	box, _ := secure.NewBox("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	w.serverAPI().Assistant = &assistant.Runner{Pool: w.pool, Box: box, Limiter: ratelimit.New(w.pool, authSecret), Log: logging.New(io.Discard),
		Brain: brainclient.New(brain.URL, strings.Repeat("s", 40), 5*time.Second), Chat: &chat.Sender{}}
	code, answer = w.call("POST", "/api/v1/assistant/try", `{"text":"Open tonight?"}`, screensSecret, w.cookie)
	if code != 200 || answer["outcome"] != "reply" || !strings.HasPrefix(answer["text"].(string), "I'm the AI assistant for") {
		t.Fatalf("try: %d %v", code, answer)
	}
	if w.count(`SELECT count(*) FROM messages WHERE company_id = $1 AND author = 'assistant'`) != 0 {
		t.Fatal("a try saves nothing")
	}
}

// In development without a key, Claude Code on this computer answers in
// place of ansa's key (the brain's free_stand_in): Settings → Assistant says
// "stand_in", never "ansa", and Home counts the AI as ready.
func TestTheFreeStandInIsNeverCalledAnsasKey(t *testing.T) {
	w := newAPIWorld(t)
	engineState := func(status string) map[string]any {
		withBrainStatus(t, w, status)
		code, answer := w.call("GET", "/api/v1/settings/assistant", "", screensSecret, w.cookie)
		if code != 200 {
			t.Fatalf("settings: %d %v", code, answer)
		}
		return answer["engineState"].(map[string]any)
	}
	state := engineState(`{"ansa_key":false,"claude_code":true,"free_stand_in":true}`)
	if state["keySource"] != "stand_in" || state["ready"] != true || state["claudeCodeAllowed"] != true {
		t.Fatalf("Claude Code stands in for ansa's key: %v", state)
	}
	_, page := w.call("GET", "/api/v1/home", "", screensSecret, w.cookie)
	engineDone := false
	for _, step := range page["gettingStarted"].([]any) {
		if step := step.(map[string]any); step["key"] == "engine" {
			engineDone = step["done"] == true
		}
	}
	if !engineDone {
		t.Fatalf("Home: the AI is ready: %v", page["gettingStarted"])
	}
	if state := engineState(`{"ansa_key":true,"claude_code":false,"free_stand_in":false}`); state["keySource"] != "ansa" || state["ready"] != true {
		t.Fatalf("ansa's own key: %v", state)
	}
	if state := engineState(`{"ansa_key":false,"claude_code":true,"free_stand_in":false}`); state["keySource"] != "none" || state["ready"] != false {
		t.Fatalf("no key, nothing standing in: %v", state)
	}
}

// withBrainStatus gives the API a fake brain whose /v1/status answers status.
func withBrainStatus(t *testing.T, w *apiWorld, status string) {
	brain := httptest.NewServer(http.HandlerFunc(func(rw http.ResponseWriter, _ *http.Request) {
		io.WriteString(rw, status)
	}))
	t.Cleanup(brain.Close)
	w.serverAPI().Brain = brainclient.New(brain.URL, strings.Repeat("s", 40), 5*time.Second)
}
