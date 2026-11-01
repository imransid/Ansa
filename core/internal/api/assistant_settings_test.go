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
