package standins

import (
	"regexp"
	"strings"
	"testing"
)

// The same name, however it is spaced or capitalized, is the same customer
// on every stand-in channel.
func TestTheSameNameIsTheSameCustomer(t *testing.T) {
	if TelegramChatID(" Lena Rossi ") != TelegramChatID("lena rossi") || TelegramChatID("Lena") == TelegramChatID("Marco") {
		t.Fatal("Telegram chat ids")
	}
	if PSID("Lena Rossi!") != "lena-rossi" || PSID(" ") != "customer" {
		t.Fatalf("Page-scoped ids: %q", PSID("Lena Rossi!"))
	}
	if WhatsAppCustomer("Lena Rossi") != "XX.lenarossi" {
		t.Fatalf("WhatsApp ids: %q", WhatsAppCustomer("Lena Rossi"))
	}
}

// A name without Latin letters or digits (Bangla, Arabic, only emoji) is its
// own customer too: every such name was ONE customer on Messenger
// ("customer") and WhatsApp ("XX.customer"). A Latin name keeps its id, so
// its conversation goes on.
func TestANameWithoutLatinLettersIsItsOwnCustomer(t *testing.T) {
	rahim, karim := "রহিম", "করিম"
	if PSID(rahim) == PSID(karim) || WhatsAppCustomer(rahim) == WhatsAppCustomer(karim) {
		t.Fatalf("two Bangla names are two customers: %q %q", PSID(rahim), WhatsAppCustomer(rahim))
	}
	if PSID(" "+rahim+" ") != PSID(rahim) || WhatsAppCustomer(rahim+" ") != WhatsAppCustomer(rahim) {
		t.Fatal("the same Bangla name, however it is spaced, is the same customer")
	}
	if PSID("???") == PSID("!!!") || strings.ContainsAny(PSID(rahim), ":-") {
		t.Fatalf("a name of other characters is its own customer, never with a contact id's separator: %q", PSID("???"))
	}
	if !regexp.MustCompile(`^XX\.[0-9]{5,20}$`).MatchString(WhatsAppCustomer(rahim)) {
		t.Fatalf("a WhatsApp id as WhatsApp's look: %q", WhatsAppCustomer(rahim))
	}
	if PSID("Rahim রহিম") != "rahim" || WhatsAppCustomer("Lena Rossi") != "XX.lenarossi" {
		t.Fatal("a name with Latin letters keeps today's id")
	}
}
