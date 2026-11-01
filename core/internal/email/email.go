// Package email is core's ONE door for sending an email (the old
// lib/send-email.ts): Resend when real email is on (SEND_REAL_EMAIL=true),
// else an HTML file in .dev-emails/ that nobody receives. A failure is a
// short code only (Resend's own code, "timeout"): a provider's message is
// free text that can name addresses, so it is never kept or logged.
package email

import (
	"context"
	"regexp"
	"strings"

	"golang.org/x/text/unicode/norm"

	"ansa/core/internal/plaintext"
)

// Message is one email. IdempotencyKey: sending the same key twice never
// delivers twice (Resend keeps it 24 hours).
type Message struct {
	From, To, ReplyTo, Subject, HTML, Text, IdempotencyKey string
}

// Result of one send: OK with the provider's id, or an error code.
type Result struct {
	OK         bool
	ProviderID string
	Error      string
}

// Sender sends email.
type Sender struct {
	// Real: through Resend with ResendKey; otherwise files in DevFolder.
	Real      bool
	ResendKey string
	DevFolder string
	// The one address every email comes from (EMAIL_FROM).
	FromAddress string
	// Tests replace Resend's address.
	ResendURL string
}

// The From address in the dev outbox when EMAIL_FROM is unset.
const devFromAddress = "no-reply@example.test"

// Send sends one email, or writes it to the dev outbox.
func (s *Sender) Send(ctx context.Context, message Message) Result {
	if s.Real {
		return s.sendWithResend(ctx, message)
	}
	return s.writeToDevOutbox(message)
}

func (s *Sender) sendingAddress() string {
	if s.FromAddress == "" {
		return devFromAddress
	}
	return s.FromAddress
}

// AccountFromHeader is "ansa" <EMAIL_FROM>: emails about a person's own account.
func (s *Sender) AccountFromHeader() string {
	return `"ansa" <` + s.sendingAddress() + `>`
}

// Room for the company's name, so " via ansa" always fits.
const maxSenderCompanyCharacters = 60

var addressParts = regexp.MustCompile(`[@"<>\\]|=\?|\?=`)

// FromHeader is "<Company> via ansa" <EMAIL_FROM> for customer and team
// emails. Every company sends from one shared address and its owner types
// its name, so the name never stands alone, and it is cleaned first: NFKC
// turns look-alikes (＠, ＜) into what they imitate, one plain line drops
// hidden tricks, then quotes, angle brackets, backslashes, "@" (a name like
// "security@bank.com" would pose as an address) and the encoded-word marks
// "=?" "?=" become spaces.
func (s *Sender) FromHeader(companyName string) string {
	plain := plaintext.SingleLine(norm.NFKC.String(companyName))
	company := plaintext.SingleLine(addressParts.ReplaceAllString(plain, " "))
	if runes := []rune(company); len(runes) > maxSenderCompanyCharacters {
		company = strings.TrimSpace(string(runes[:maxSenderCompanyCharacters]))
	}
	sender := "ansa"
	if company != "" {
		sender = company + " via ansa"
	}
	return `"` + sender + `" <` + s.sendingAddress() + `>`
}

var codePattern = regexp.MustCompile(`^[A-Za-z0-9_]{1,64}$`)

// errorCode keeps a provider's code to the allowed shape, never its message.
func errorCode(code string) string {
	if codePattern.MatchString(code) {
		return code
	}
	return "unknown_error"
}
