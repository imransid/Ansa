package accounts

import (
	"context"
	"html"
	"strings"
	"time"

	"ansa/core/internal/email"
	"ansa/core/internal/logging"
	"ansa/core/internal/ratelimit"
)

// Mailer is email.Sender (the tests use a stand-in writing files too).
type Mailer interface {
	Send(ctx context.Context, message email.Message) email.Result
	AccountFromHeader() string
}

// Anyone can sign up any address, ask for a reset of any address, and every
// login of an unconfirmed account mails a new link: at most 3 of each kind
// per address an hour. Over it, nothing is sent and nothing is said (the
// links of the last hour still work: they last an hour too).
var accountEmailsPerAddress = ratelimit.Rule{MaxAttempts: 3, Window: time.Hour}

// The three account emails. None repeats the name typed at signup: anyone
// can sign up any address, so that name would put a stranger's words at the
// top of our email.
func confirmEmail(link string) (subject, text, htmlBody string) {
	return "Confirm your email address",
		lines("Hello,", "", "Confirm your email address to finish setting up your ansa account. Open this link and enter your ansa password:", link, "",
			"The link works for one hour.", "If you didn't sign up for ansa, you can ignore this email: without the password, the link does nothing."),
		page("<p>Hello,</p>", "<p>Confirm your email address to finish setting up your ansa account. Open this link and enter your ansa password:</p>",
			`<p><a href="`+html.EscapeString(link)+`">Confirm my email address</a></p>`, "<p>The link works for one hour.</p>",
			"<p>If you didn't sign up for ansa, you can ignore this email: without the password, the link does nothing.</p>")
}

func existingAccountEmail(loginLink, resetLink string) (subject, text, htmlBody string) {
	return "You already have an ansa account",
		lines("Hello,", "", "Someone, probably you, just tried to sign up for ansa with this email address. It already has an ansa account, so nothing was changed.", "",
			"To use your account, log in:", loginLink, "",
			"If you signed up before but never confirmed your address, log in with the password you chose then, and we'll email you a new confirmation link.", "",
			"Forgot your password, or never chose one yourself? Reset it here:", resetLink, "",
			"One email address can belong to one company only. To join another company's team, ask its owner to invite a different address.", "",
			"If an owner removed you from your team, this account can no longer log in, and the address can't be used for another account.", "",
			"If you didn't try to sign up, you can ignore this email."),
		page("<p>Hello,</p>", "<p>Someone, probably you, just tried to sign up for ansa with this email address. It already has an ansa account, so nothing was changed.</p>",
			`<p><a href="`+html.EscapeString(loginLink)+`">Log in to your account</a></p>`,
			"<p>If you signed up before but never confirmed your address, log in with the password you chose then, and we'll email you a new confirmation link.</p>",
			`<p>Forgot your password, or never chose one yourself? <a href="`+html.EscapeString(resetLink)+`">Reset your password</a></p>`,
			"<p>One email address can belong to one company only. To join another company's team, ask its owner to invite a different address.</p>",
			"<p>If an owner removed you from your team, this account can no longer log in, and the address can't be used for another account.</p>",
			"<p>If you didn't try to sign up, you can ignore this email.</p>")
}

func resetEmail(link string) (subject, text, htmlBody string) {
	return "Reset your ansa password",
		lines("Hello,", "", "Someone, probably you, asked to reset the password of the ansa account for this email address. Open this link to choose a new password:", link, "",
			"The link works once, for one hour. Choosing a new password logs the account out on every device.",
			"If you didn't ask for this, you can ignore this email: your password stays as it is."),
		page("<p>Hello,</p>", "<p>Someone, probably you, asked to reset the password of the ansa account for this email address. Open this link to choose a new password:</p>",
			`<p><a href="`+html.EscapeString(link)+`">Choose a new password</a></p>`,
			"<p>The link works once, for one hour. Choosing a new password logs the account out on every device.</p>",
			"<p>If you didn't ask for this, you can ignore this email: your password stays as it is.</p>")
}

func lines(parts ...string) string {
	return strings.Join(parts, "\n")
}

func page(paragraphs ...string) string {
	return "<!doctype html>\n<html>\n  <body style=\"font-family: sans-serif; line-height: 1.5; color: #111;\">\n    " +
		strings.Join(paragraphs, "\n    ") + "\n  </body>\n</html>"
}

// sendAccountEmail sends one account email from "ansa" <EMAIL_FROM>, unless
// the address had 3 of this kind in the last hour. kind: "verification-email",
// "existing-account-email" or "password-reset-email" (the old counters).
// A new idempotency key every time: each is its own email with its own link.
func (s *Service) sendAccountEmail(ctx context.Context, kind, to, userID, subject, text, htmlBody string) {
	if over, err := s.Limits.Over(ctx, kind, to, accountEmailsPerAddress); err != nil || over {
		return
	}
	s.sendEmailNow(ctx, kind, to, userID, subject, text, htmlBody)
}

// sendEmailNow sends one account email, its limit already counted.
func (s *Service) sendEmailNow(ctx context.Context, kind, to, userID, subject, text, htmlBody string) {
	key, err := newID(24)
	if err != nil {
		return
	}
	result := s.Mail.Send(ctx, email.Message{From: s.Mail.AccountFromHeader(), To: to, Subject: subject, Text: text, HTML: htmlBody, IdempotencyKey: kind + "-" + userID + "-" + key})
	if !result.OK && s.Log != nil {
		// Never the address or the link.
		s.Log.Error("accounts: an account email was not sent", logging.Code(result.Error))
	}
}
