// Package standins names the made-up customers of the development stand-in
// channels (the simulate tools and the practice chat): the same name is
// always the same customer, so a conversation goes on where it was. Pure.
package standins

import (
	"crypto/sha256"
	"encoding/binary"
	"regexp"
	"strings"
)

// TelegramChatID is a made-up Telegram customer's chat id: a whole number
// from the name's hash (as the old simulate script made it, so its
// conversations continue).
func TelegramChatID(name string) uint64 {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(name))))
	var six [8]byte
	copy(six[2:], sum[:6])
	return binary.BigEndian.Uint64(six[:])
}

// PSID is a made-up Messenger customer's Page-scoped id: the name in small
// letters and digits joined by "-" ("customer" when nothing is left).
func PSID(name string) string {
	psid := strings.Trim(notLettersOrDigits.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if psid == "" {
		return "customer"
	}
	return psid
}

// WhatsAppCustomer is a made-up WhatsApp customer's business-scoped id, as
// WhatsApp's look: "XX.<name>".
func WhatsAppCustomer(name string) string {
	return "XX." + strings.ReplaceAll(PSID(name), "-", "")
}

var notLettersOrDigits = regexp.MustCompile(`[^a-z0-9]+`)
