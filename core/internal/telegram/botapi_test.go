package telegram

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

// fakeBotAPI answers as Telegram's Bot API would; the tests never reach
// Telegram, and refuse to run while a real bot token is set.
func fakeBotAPI(t *testing.T, handler http.HandlerFunc) {
	if os.Getenv("TELEGRAM_BOT_TOKEN") != "" {
		t.Fatal("TELEGRAM_BOT_TOKEN is set, so these tests could reach Telegram. Leave it unset to run them.")
	}
	server := httptest.NewServer(handler)
	old := APIHost
	APIHost = server.URL
	t.Cleanup(func() { APIHost = old; server.Close() })
}

func TestSettingTheWebhookSendsTheAddressTheSecretAndTheUpdatesAnsaReads(t *testing.T) {
	var got map[string]any
	status := http.StatusOK
	fakeBotAPI(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/botTOKEN/setWebhook" && r.URL.Path != "/botTOKEN/deleteWebhook" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(status)
		w.Write([]byte(`{"ok":true,"result":true}`))
	})
	ctx := context.Background()
	if result := SetWebhook(ctx, "TOKEN", "https://core.example.test/webhooks/telegram", "the-secret"); !result.OK {
		t.Fatalf("set: %+v", result)
	}
	if got["url"] != "https://core.example.test/webhooks/telegram" || got["secret_token"] != "the-secret" || len(got["allowed_updates"].([]any)) != 4 {
		t.Fatalf("asked: %v", got)
	}
	if result := DeleteWebhook(ctx, "TOKEN"); !result.OK {
		t.Fatalf("delete: %+v", result)
	}
	status = http.StatusUnauthorized
	if result := DeleteWebhook(ctx, "TOKEN"); result.OK || result.Status != 401 {
		t.Fatalf("a refusal is its status only: %+v", result)
	}
	if result := SetWebhook(ctx, "WRONG", "https://x.test", "s"); result.OK || result.Status != 404 {
		t.Fatalf("an unknown token: %+v", result)
	}
}

func TestPollingReadsTheUpdatesOrSaysAWebhookIsSet(t *testing.T) {
	webhookSet := false
	fakeBotAPI(t, func(w http.ResponseWriter, r *http.Request) {
		if webhookSet {
			w.WriteHeader(http.StatusConflict)
			return
		}
		var asked struct {
			Offset  int64 `json:"offset"`
			Timeout int   `json:"timeout"`
		}
		json.NewDecoder(r.Body).Decode(&asked)
		if asked.Offset != 7 || asked.Timeout != 25 {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Write([]byte(`{"ok":true,"result":[{"update_id":7,"message":{}},{"update_id":8}]}`))
	})
	ctx := context.Background()
	result := GetUpdates(ctx, "TOKEN", 7)
	if !result.OK || len(result.Updates) != 2 || string(result.Updates[1]) != `{"update_id":8}` {
		t.Fatalf("read: %+v", result)
	}
	if result := GetUpdates(ctx, "TOKEN", 9); result.OK || result.Status != 400 {
		t.Fatalf("a refusal: %+v", result)
	}
	webhookSet = true
	if result := GetUpdates(ctx, "TOKEN", 7); result.OK || !result.WebhookSet {
		t.Fatalf("a webhook is set: %+v", result)
	}
}
