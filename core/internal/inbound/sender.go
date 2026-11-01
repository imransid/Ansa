// Package inbound turns a received email into a request (the old
// services/inbound-email-*.ts and db/inbound-email-processing.ts): claim it,
// fetch its content, never take ansa's own mail (a loop), skip what must
// not become a request on its own (filters), let the brain triage it, and
// save the request with the email encrypted, in one transaction. Whatever
// fails after the content arrived still saves one fallback request: only a
// database outage can stop an email from becoming one.
package inbound

import (
	"regexp"
	"strings"
	"unicode/utf8"

	"ansa/core/internal/addresses"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/resend"
)

// Mailbox is one "Name <address>" as written.
type Mailbox struct {
	Name    string
	Address string
}

var angleAtEnd = regexp.MustCompile(`<([^<>]*)>\s*$`)
var addressThenComment = regexp.MustCompile(`^([^\s()<>@]+@[^\s()<>@]+)\s*\(([^()]*)\)$`)
var quotedEscape = regexp.MustCompile(`\\(.)`)

// ParseMailbox reads "Ana <ana@x.com>", "\"Smith, Ana\" <ana@x.com>",
// "ana@x.com (Ana)" or "ana@x.com": the address is the LAST <...> group.
// The address is lowercased, never checked here.
func ParseMailbox(text string) Mailbox {
	text = strings.TrimSpace(text)
	if match := angleAtEnd.FindStringSubmatchIndex(text); match != nil {
		return Mailbox{Name: cleanName(text[:match[0]]), Address: strings.ToLower(strings.TrimSpace(text[match[2]:match[3]]))}
	}
	if match := addressThenComment.FindStringSubmatch(text); match != nil {
		return Mailbox{Name: cleanName(match[2]), Address: strings.ToLower(match[1])}
	}
	return Mailbox{Address: strings.ToLower(text)}
}

func cleanName(raw string) string {
	name := strings.TrimSpace(raw)
	if len(name) >= 2 && strings.HasPrefix(name, `"`) && strings.HasSuffix(name, `"`) {
		name = quotedEscape.ReplaceAllString(name[1:len(name)-1], "$1")
	}
	return cutRunes(plaintext.SingleLine(name), 200)
}

// Sender is who sent a received email, as far as can be told.
type Sender struct {
	Name string
	// The sender's address when it is a valid customer address, else "".
	Address string
	// What the request shows as the sender ("" = no From at all).
	Shown string
	// Resend's DKIM or DMARC passed for a From with exactly one "@".
	Verified bool
	// "ansa" (ansa's own addresses: a loop), "company" (a support address), or "".
	Own string
	// The one Reply-To that differs from From (contact forms): a suggestion only.
	ReplyTo string
	// Counts this sender's emails for the hourly flood limit.
	FloodKey string
}

// ReadSender reads the sender. Resend gives `from` as the bare address and
// the name only in headers.from, so both are read, and must name the same
// address; a From over 2,000 characters is read at its end and never
// verified (what was cut off could hold a second address).
func ReadSender(c *resend.Content, supportAddresses []string, emailFrom, forwardingDomain string) Sender {
	fullHeader, fullField := strings.TrimSpace(header(c.Headers, "from")), strings.TrimSpace(c.From)
	wasCut := len(fullHeader) > 2000 || len(fullField) > 2000
	fromHeader, fromField := lastBytes(fullHeader, 2000), lastBytes(fullField, 2000)
	mailbox := ParseMailbox(firstNonEmpty(fromField, fromHeader))
	agree := true
	var headerBox Mailbox
	if fromHeader != "" {
		headerBox = ParseMailbox(fromHeader)
		agree = addresses.Normalize(headerBox.Address) == addresses.Normalize(mailbox.Address)
	}
	address, _ := addresses.CustomerEmail(mailbox.Address)
	shown := address
	if shown == "" {
		shown = cutRunes(plaintext.SingleLine(mailbox.Address), 320)
	}
	s := Sender{Name: mailbox.Name, Address: address, Shown: shown}
	if s.Name == "" && agree {
		s.Name = headerBox.Name
	}
	// Resend checks the From address as ITS parser reads it: with exactly one
	// "@" in every From text there is only one address it could have checked.
	oneAt := true
	for _, text := range []string{fromField, fromHeader} {
		if text != "" && strings.Count(text, "@") != 1 {
			oneAt = false
		}
	}
	auth := c.Authentication
	s.Verified = address != "" && agree && !wasCut && oneAt && auth != nil && (auth.DKIM == "pass" || auth.DMARC == "pass")
	s.Own = ownKind(shown, supportAddresses, emailFrom, forwardingDomain)
	s.ReplyTo = readReplyTo(c.ReplyTo, address, supportAddresses, emailFrom, forwardingDomain)
	s.FloodKey = firstNonEmpty(s.ReplyTo, s.Shown, "unknown sender")
	return s
}

// ownKind: "ansa" for ansa's sending address or anything on the forwarding
// domain, "company" for one of the company's support addresses.
func ownKind(address string, supportAddresses []string, emailFrom, forwardingDomain string) string {
	switch {
	case address == "":
		return ""
	case strings.EqualFold(address, emailFrom) || strings.HasSuffix(address, "@"+forwardingDomain):
		return "ansa"
	}
	for _, support := range supportAddresses {
		if support == address {
			return "company"
		}
	}
	return ""
}

// readReplyTo: exactly one Reply-To that isn't one of our own addresses, a
// valid one, and not the sender's own; anything else is no suggestion.
func readReplyTo(replyTo []string, sender string, support []string, emailFrom, domain string) string {
	var notOurs []string
	for _, entry := range replyTo {
		address := ParseMailbox(entry).Address
		if ownKind(addresses.Normalize(address), support, emailFrom, domain) == "" {
			notOurs = append(notOurs, address)
		}
	}
	if len(notOurs) != 1 {
		return ""
	}
	address, _ := addresses.CustomerEmail(notOurs[0])
	if address == sender {
		return ""
	}
	return address
}

// header reads a header by its name in any case.
func header(headers map[string]string, name string) string {
	for key, value := range headers {
		if strings.EqualFold(key, name) {
			return value
		}
	}
	return ""
}

func lastBytes(text string, max int) string {
	if len(text) <= max {
		return text
	}
	cut := text[len(text)-max:]
	for !utf8.ValidString(cut) && len(cut) > 0 {
		cut = cut[1:]
	}
	return cut
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func cutRunes(text string, max int) string {
	if utf8.RuneCountInString(text) <= max {
		return text
	}
	return strings.TrimSpace(string([]rune(text)[:max]))
}
