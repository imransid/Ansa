package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"ansa/core/internal/telegram"
)

// fakeBot answers getUpdates: the batches given, then 409 (a webhook is
// set). The tests never reach Telegram: they refuse to run while a real bot
// token is set (as the old checks did).
type fakeBot struct {
	batches []string
	offsets []int64
}

func newFakeBot(t *testing.T, batches ...string) *fakeBot {
	if os.Getenv("TELEGRAM_BOT_TOKEN") != "" {
		t.Fatal("TELEGRAM_BOT_TOKEN is set, so these tests could reach Telegram. Leave it unset (comment out the three TELEGRAM_ lines of .env.core) to run them.")
	}
	bot := &fakeBot{batches: batches}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/getUpdates") {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		var asked struct {
			Offset int64 `json:"offset"`
		}
		json.NewDecoder(r.Body).Decode(&asked)
		bot.offsets = append(bot.offsets, asked.Offset)
		if len(bot.batches) == 0 {
			w.WriteHeader(http.StatusConflict)
			return
		}
		w.Write([]byte(`{"ok":true,"result":[` + bot.batches[0] + `]}`))
		bot.batches = bot.batches[1:]
	}))
	old := telegram.APIHost
	telegram.APIHost = server.URL
	t.Cleanup(func() { telegram.APIHost = old; server.Close() })
	return bot
}

// Each update goes to core's webhook code as the webhook would receive it
// (saved once, the reply queued), the next read starts after it, and a bot
// with a webhook stops the poll.
func TestTelegramPollHandsEachUpdateToCoresWebhookCode(t *testing.T) {
	w := newTestWorld(t)
	w.forgetRateLimits([2]string{"telegram-webhook", "127.0.0.1"})
	if _, err := w.run("telegram-poll"); err == nil || !strings.Contains(err.Error(), "Set TELEGRAM_BOT_TOKEN") {
		t.Fatalf("without the bot's settings: %v", err)
	}
	connection := "bc-" + randomHex(8)
	_, err := w.pool.Exec(context.Background(), `
		INSERT INTO channel_connections (company_id, channel, external_id, account_telegram_id, account_chat_id, display_name, connected_by_user_id)
		VALUES ($1, 'telegram', $2, '9001', '9001', 'Luigi', $3)`, w.company.String(), connection, w.ownerID)
	if err != nil {
		t.Fatalf("connecting: %v", err)
	}
	message := `{"update_id":41,"business_message":{"message_id":7,"business_connection_id":"` + connection + `",
		"chat":{"id":555,"type":"private","first_name":"Lena"},"from":{"id":555,"first_name":"Lena"},"text":"Are you open?"}}`
	bot := newFakeBot(t, message+`,{"update_id":42,"edited_message":{}}`, message)
	w.settings["TELEGRAM_BOT_TOKEN"] = "123456:fake-token-for-the-tests"
	w.settings["TELEGRAM_BOT_USERNAME"] = "ansa_test_bot"
	w.settings["TELEGRAM_WEBHOOK_SECRET"] = strings.Repeat("s", 40)
	out, err := w.run("telegram-poll")
	if err == nil || !strings.Contains(err.Error(), "This bot has a webhook") {
		t.Fatalf("a webhook stops the poll: %v", err)
	}
	if !strings.Contains(out, "Handled an update (a chat message).") || strings.Contains(out, "Are you open") || strings.Contains(out, "fake-token") {
		t.Fatalf("what it printed: %q", out)
	}
	if len(bot.offsets) != 3 || bot.offsets[0] != 0 || bot.offsets[1] != 43 || bot.offsets[2] != 43 {
		t.Fatalf("each read starts after the last update: %v", bot.offsets)
	}
	if w.count(`SELECT count(*) FROM messages WHERE company_id = $1`) != 1 || w.count(replyJobs) != 1 {
		t.Fatal("the message is saved once (it came twice), with one reply queued")
	}
}
