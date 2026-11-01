// Package addresses checks customer and other outside email addresses (the
// old lib/validation/customer-email.ts and lib/email-address.ts): a
// request's customer email, a received email's sender, a company's support
// and reply-to addresses. Looser than team accounts' rule on purpose: real
// customers write from international domains (ivan@почта.рф) and with
// "&", "=", "%" before the "@". It follows what browsers accept for
// type="email", with the domain converted to ASCII and at least one dot in it.
package addresses

import (
	"regexp"
	"strings"

	"golang.org/x/net/idna"
)

// The browser's type="email" rule (HTML's own pattern).
var html5Email = regexp.MustCompile("^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$")

// Letters of any script, marks, digits, dots and hyphens: all a domain can
// hold. Anything else is left for the check to refuse, never "repaired".
var domainCharacters = regexp.MustCompile(`^[\p{L}\p{M}\p{N}.-]+$`)

// Normalize trims and lowercases an address and writes an international
// domain the way mail servers need it ("ivan@почта.рф" ->
// "ivan@xn--80a1acny.xn--p1ai"). It never decides whether it is valid.
func Normalize(text string) string {
	address := strings.ToLower(strings.TrimSpace(text))
	at := strings.LastIndex(address, "@")
	if at <= 0 {
		return address
	}
	domain := address[at+1:]
	if isPrintableASCII(domain) || !domainCharacters.MatchString(domain) {
		return address
	}
	ascii, err := idna.Lookup.ToASCII(domain)
	if err != nil {
		return address
	}
	return address[:at+1] + ascii
}

// CustomerEmail is the cleaned-up address, or "" with the words saying what is wrong.
func CustomerEmail(text string) (string, string) {
	if len(text) > 320 {
		return "", "Email is too long"
	}
	address := Normalize(text)
	switch {
	case !html5Email.MatchString(address):
		return "", "Enter a valid email address"
	case len(address) > 254:
		return "", "Email is too long"
	case !strings.Contains(address[strings.LastIndex(address, "@")+1:], "."):
		// "user@localhost" passes the browser's rule but can't be a customer's.
		return "", "Enter a valid email address"
	}
	return address, ""
}

func isPrintableASCII(text string) bool {
	for i := 0; i < len(text); i++ {
		if text[i] < ' ' || text[i] > '~' {
			return false
		}
	}
	return true
}

// A team account's address: Zod's own email rule (the old emailSchema),
// stricter than a customer's. RE2 has no lookahead: "no leading dot" and
// "no two dots in a row" are checked apart.
var accountEmail = regexp.MustCompile(`^[A-Za-z0-9_'+\-.]*[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$`)

// AccountEmail is a team account's address trimmed and lower-cased, or a
// problem in words: at most 254 characters, Zod's email rule.
func AccountEmail(text string) (string, string) {
	address := strings.ToLower(strings.TrimSpace(text))
	switch {
	case len(address) > 254:
		return "", "Email is too long"
	case !accountEmail.MatchString(address) || strings.HasPrefix(address, ".") || strings.Contains(address, ".."):
		return "", "Enter a valid email address"
	}
	return address, ""
}
