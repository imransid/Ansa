package api

import (
	"strings"
	"testing"
)

func TestConnections(t *testing.T) {
	w := newAPIWorld(t)
	code, answer := w.call("GET", "/api/v1/channels", "", screensSecret, w.cookie)
	page := answer["page"].(map[string]any)
	if code != 200 || page["telegram"] != nil || !strings.HasSuffix(page["forwardingAddress"].(string), "@inbound.ansa.test") || answer["telegramMode"] != "stand-in" {
		t.Fatalf("connections: %d %v", code, answer)
	}
	if code, answer := w.call("POST", "/api/v1/channels/telegram/link", "", screensSecret, w.cookie); code != 409 || !strings.Contains(answer["error"].(string), "isn't set up") {
		t.Fatalf("no bot, no link: %d %v", code, answer)
	}
	if code, _ := w.call("POST", "/api/v1/channels/telegram/stand-in", "", screensSecret, w.cookie); code != 200 {
		t.Fatal("a stand-in account in development")
	}
	if code, _ := w.call("POST", "/api/v1/channels/telegram/stand-in", "", screensSecret, w.cookie); code != 409 {
		t.Fatal("only one account")
	}
	_, answer = w.call("GET", "/api/v1/channels", "", screensSecret, w.cookie)
	if answer["page"].(map[string]any)["telegram"].(map[string]any)["isStandIn"] != true {
		t.Fatal("the stand-in shows")
	}
	w.call("POST", "/api/v1/channels/telegram/disconnect", "", screensSecret, w.cookie)
	_, answer = w.call("GET", "/api/v1/channels", "", screensSecret, w.cookie)
	if answer["page"].(map[string]any)["telegram"] != nil {
		t.Fatal("disconnected")
	}
	w.serverAPI().TelegramBot = "ansa_test_bot"
	code, answer = w.call("POST", "/api/v1/channels/telegram/link", "", screensSecret, w.cookie)
	link, _ := answer["link"].(string)
	if code != 200 || !strings.HasPrefix(link, "https://t.me/ansa_test_bot?start=") || len(strings.TrimPrefix(link, "https://t.me/ansa_test_bot?start=")) != 43 {
		t.Fatalf("a one-time link with a 43-character code: %d %v", code, answer)
	}
	if w.count(`SELECT count(*) FROM telegram_link_codes WHERE company_id = $1 AND expires_at > now() + interval '9 minutes'`) != 1 {
		t.Fatal("only the code's hash is kept, for 10 minutes")
	}
}
