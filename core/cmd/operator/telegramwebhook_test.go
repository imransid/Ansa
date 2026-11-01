package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"ansa/core/internal/telegram"
)

const (
	fakeBotToken      = "123456:fake-token-for-the-tests"
	fakeWebhookSecret = "a-made-up-webhook-secret-of-forty-chars!"
)

// fakeTelegram answers the Bot API's setup methods and remembers what it
// was asked. The tests never reach Telegram: they refuse to run while a real
// bot token is set (as the old checks did).
type fakeTelegram struct {
	asked  []string
	got    map[string]any
	status int
}

func newFakeTelegram(t *testing.T) *fakeTelegram {
	if os.Getenv("TELEGRAM_BOT_TOKEN") != "" {
		t.Fatal("TELEGRAM_BOT_TOKEN is set, so these tests could reach Telegram. Leave it unset (comment out the three TELEGRAM_ lines of .env.core) to run them.")
	}
	fake := &fakeTelegram{status: http.StatusOK}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fake.asked = append(fake.asked, r.URL.Path)
		json.NewDecoder(r.Body).Decode(&fake.got)
		w.WriteHeader(fake.status)
		w.Write([]byte(`{"ok":true,"result":true,"description":"Telegram's own words, never read"}`))
	}))
	old := telegram.APIHost
	telegram.APIHost = server.URL
	t.Cleanup(func() { telegram.APIHost = old; server.Close() })
	return fake
}

func telegramSettings() map[string]string {
	settings := baseSettings("postgres://ansa@localhost:5432/never-asked")
	settings["TELEGRAM_BOT_TOKEN"] = fakeBotToken
	settings["TELEGRAM_BOT_USERNAME"] = "ansa_test_bot"
	settings["TELEGRAM_WEBHOOK_SECRET"] = fakeWebhookSecret
	return settings
}

func runWith(settings map[string]string, args ...string) (string, error) {
	var out bytes.Buffer
	err := run(context.Background(), args, func(name string) string { return settings[name] }, &out)
	return out.String(), err
}

// set tells Telegram core's webhook address (https only) with the secret
// and the four kinds of updates; remove takes it off. The output names the
// outcome, never the token or the secret.
func TestTelegramWebhookSetsCoresAddressWithTheSecret(t *testing.T) {
	fake := newFakeTelegram(t)
	settings := telegramSettings()
	out, err := runWith(settings, "telegram-webhook", "set", "https://core.example.test/")
	if err != nil || !strings.Contains(out, "Webhook set: Telegram now sends @ansa_test_bot's updates to https://core.example.test/webhooks/telegram.") {
		t.Fatalf("set: %q %v", out, err)
	}
	if fake.asked[0] != "/bot"+fakeBotToken+"/setWebhook" || fake.got["url"] != "https://core.example.test/webhooks/telegram" || fake.got["secret_token"] != fakeWebhookSecret {
		t.Fatalf("asked: %v %v", fake.asked, fake.got)
	}
	if kinds, _ := json.Marshal(fake.got["allowed_updates"]); string(kinds) != `["message","business_connection","business_message","deleted_business_messages"]` {
		t.Fatalf("the updates ansa reads: %s", kinds)
	}
	if strings.Contains(out, fakeBotToken) || strings.Contains(out, fakeWebhookSecret) {
		t.Fatal("the output never holds the token or the secret")
	}
	if out, err := runWith(settings, "telegram-webhook", "remove"); err != nil || !strings.Contains(out, "Webhook removed") || fake.asked[1] != "/bot"+fakeBotToken+"/deleteWebhook" {
		t.Fatalf("remove: %q %v %v", out, err, fake.asked)
	}
	for _, refused := range []string{"http://core.example.test", "https://", "https://core.example.test/?a=1"} {
		if _, err := runWith(settings, "telegram-webhook", "set", refused); err == nil || !strings.Contains(err.Error(), "https addresses only") {
			t.Fatalf("%q: %v", refused, err)
		}
	}
	if len(fake.asked) != 2 {
		t.Fatalf("a refused address asks Telegram nothing: %v", fake.asked)
	}
}

func TestTelegramWebhookSaysWhyItFailedWithoutTelegramsWords(t *testing.T) {
	fake := newFakeTelegram(t)
	fake.status = http.StatusUnauthorized
	_, err := runWith(telegramSettings(), "telegram-webhook", "remove")
	if err == nil || err.Error() != "Telegram refused (HTTP 401). Check the bot's token." {
		t.Fatalf("a refusal: %v", err)
	}
	if _, err := runWith(baseSettings("postgres://ansa@localhost:5432/x"), "telegram-webhook", "remove"); err == nil || !strings.Contains(err.Error(), "Set TELEGRAM_BOT_TOKEN") {
		t.Fatalf("without the bot's settings: %v", err)
	}
	if len(fake.asked) != 1 {
		t.Fatalf("without settings Telegram isn't asked: %v", fake.asked)
	}
}
