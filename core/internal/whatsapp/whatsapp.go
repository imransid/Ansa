// Package whatsapp is the WhatsApp Business channel (step 56): a company
// connects its WhatsApp number through Meta's Cloud API with Embedded
// Signup (Meta's own sign-up window), and its customers' messages reach
// ansa through Meta's signed webhook. A customer is their id on that
// number: their contact's id is "<phone number id>:<customer id>", so a
// reply goes back from that number. The customer id is Meta's
// business-scoped user id ("US.1349...", in every message since April
// 2026; a user with a WhatsApp username may hide their number), else their
// number's digits. The business may keep using the WhatsApp Business app on
// the same number ("coexistence"): what it writes there arrives as an echo.
// This package is the ONLY code that talks to WhatsApp.
package whatsapp

import (
	"regexp"
	"strings"
)

// Meta's numeric ids (a business account, a phone number).
var metaID = regexp.MustCompile(`^[0-9]{1,40}$`)

// A customer's id: a business-scoped user id (a country code, a period and
// digits) or a number's digits. Never a ":" (the contact id's separator).
var customerID = regexp.MustCompile(`^(?:[A-Z]{2,3}(?:\.[0-9A-Za-z]{1,80}){1,2}|[0-9]{5,20})$`)

// ContactID is a customer's id on one business number.
func ContactID(phoneNumberID, customer string) string {
	return phoneNumberID + ":" + customer
}

// SplitContactID splits at the LAST ":" (a stand-in number's id,
// "stand-in:<uuid>", holds one; a customer id never does).
func SplitContactID(externalID string) (phoneNumberID, customer string, ok bool) {
	at := strings.LastIndex(externalID, ":")
	if at <= 0 || at == len(externalID)-1 {
		return "", "", false
	}
	return externalID[:at], externalID[at+1:], true
}

// isUserID: a business-scoped user id, sent as "recipient" (a number's
// digits go as "to").
func isUserID(customer string) bool {
	return strings.Contains(customer, ".")
}
