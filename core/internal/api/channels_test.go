package api

import (
	"strings"
	"testing"

	"ansa/core/internal/whatsapp"
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

// WhatsApp (step 56): not set up without ansa's Meta app; a stand-in
// number in development; the sign-up's values for the page only once the
// app is set up, and a sign-up Meta can't confirm is refused with words.
func TestWhatsAppConnections(t *testing.T) {
	w := newAPIWorld(t)
	if _, answer := w.call("GET", "/api/v1/channels", "", screensSecret, w.cookie); answer["whatsappMode"] != "not-set-up" || answer["whatsappSignup"] != nil {
		t.Fatalf("no connector: %v", answer)
	}
	w.serverAPI().WhatsApp = &whatsapp.Connector{Pool: w.pool, Box: w.api.Box, Development: true}
	if code, _ := w.call("POST", "/api/v1/channels/whatsapp/connect", `{"code":"c","wabaId":"777","phoneNumberId":"1"}`, screensSecret, w.cookie); code != 409 {
		t.Fatal("no Meta app, no sign-up")
	}
	if code, _ := w.call("POST", "/api/v1/channels/whatsapp/stand-in", "", screensSecret, w.cookie); code != 200 {
		t.Fatal("a stand-in number in development")
	}
	if code, _ := w.call("POST", "/api/v1/channels/whatsapp/stand-in", "", screensSecret, w.cookie); code != 409 {
		t.Fatal("one number per company")
	}
	_, answer := w.call("GET", "/api/v1/channels", "", screensSecret, w.cookie)
	if number, _ := answer["page"].(map[string]any)["whatsapp"].(map[string]any); answer["whatsappMode"] != "stand-in" || number["isStandIn"] != true || number["status"] != "connected" {
		t.Fatalf("the stand-in shows: %v", answer)
	}
	w.call("POST", "/api/v1/channels/whatsapp/disconnect", "", screensSecret, w.cookie)
	if _, answer := w.call("GET", "/api/v1/channels", "", screensSecret, w.cookie); answer["page"].(map[string]any)["whatsapp"] != nil {
		t.Fatal("disconnected")
	}
	w.serverAPI().WhatsApp = &whatsapp.Connector{Pool: w.pool, Box: w.api.Box, AppID: "987", AppSecret: "secret", SignupConfigID: "123"}
	_, answer = w.call("GET", "/api/v1/channels", "", screensSecret, w.cookie)
	if signup, _ := answer["whatsappSignup"].(map[string]any); answer["whatsappMode"] != "real" || signup["appId"] != "987" || signup["configId"] != "123" {
		t.Fatalf("what the page needs to open Meta's window: %v", answer)
	}
	if code, _ := w.call("POST", "/api/v1/channels/whatsapp/connect", `{"code":"c","wabaId":"777","phoneNumberId":"1","company":"x"}`, screensSecret, w.cookie); code != 400 {
		t.Fatal("an unknown field is refused")
	}
	code, answer := w.call("POST", "/api/v1/channels/whatsapp/connect", `{"code":"c","wabaId":"777","phoneNumberId":"1/register"}`, screensSecret, w.cookie)
	if message, _ := answer["error"].(string); code != 422 || !strings.Contains(message, "didn't confirm that number") {
		t.Fatalf("a number Meta can't confirm (here: not an id at all, so Meta isn't even asked): %d %v", code, answer)
	}
}
