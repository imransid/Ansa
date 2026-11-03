package standins

import "testing"

// The same name, however it is spaced or capitalized, is the same customer
// on every stand-in channel.
func TestTheSameNameIsTheSameCustomer(t *testing.T) {
	if TelegramChatID(" Lena Rossi ") != TelegramChatID("lena rossi") || TelegramChatID("Lena") == TelegramChatID("Marco") {
		t.Fatal("Telegram chat ids")
	}
	if PSID("Lena Rossi!") != "lena-rossi" || PSID("???") != "customer" {
		t.Fatalf("Page-scoped ids: %q", PSID("Lena Rossi!"))
	}
	if WhatsAppCustomer("Lena Rossi") != "XX.lenarossi" {
		t.Fatalf("WhatsApp ids: %q", WhatsAppCustomer("Lena Rossi"))
	}
}
