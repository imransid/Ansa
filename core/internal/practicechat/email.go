package practicechat

import (
	"context"
	"strings"

	"ansa/core/internal/commands"
	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/resend"
	"ansa/core/internal/tenant"
)

// Email is a made-up customer's email, its fields checked by the API.
type Email struct {
	Name, Address, Subject, Text string
	// Resend reports DKIM and DMARC passed: the sender is verified.
	Verified bool
}

// SendEmail sends the made-up customer's email to the company's forwarding
// address as a forwarded email arrives through Resend: its content where
// core's development fetcher reads received emails (inboxFolder), then the
// email saved and its processing queued as Resend's webhook saves one.
// Core's workers make it a request in a moment. It returns the address the
// email went to.
func SendEmail(ctx context.Context, pool *database.Pool, inboxFolder, forwardingDomain string, company tenant.CompanyID, email Email) (string, error) {
	forwarding, err := commands.ForwardingAddress(ctx, pool, company, forwardingDomain)
	if err != nil {
		return "", err
	}
	id, err := conversations.NewID()
	if err != nil {
		return "", err
	}
	resendEmailID := "practice-" + id
	if err := resend.WriteDevInbound(inboxFolder, resendEmailID, receivedContent(email, forwarding)); err != nil {
		return "", err
	}
	return forwarding, resend.SaveAndQueue(ctx, pool, company, resendEmailID)
}

// receivedContent is the email as Resend's Receiving API gives it: `from`
// the bare address, the name only in headers.from, and Resend's own SPF,
// DKIM and DMARC results.
func receivedContent(email Email, forwarding string) map[string]any {
	result := "fail"
	if email.Verified {
		result = "pass"
	}
	return map[string]any{
		"from": email.Address, "to": []string{forwarding}, "reply_to": []string{},
		"subject": email.Subject, "text": email.Text, "html": nil, "attachments": []any{},
		"headers":        map[string]string{"from": fromHeader(email.Name, email.Address)},
		"authentication": map[string]string{"spf": result, "dkim": result, "dmarc": result},
	}
}

// fromHeader is the From header as a mail program writes it: the name in
// quotes (so a comma or a quote in it stays part of the name), then the
// address.
func fromHeader(name, address string) string {
	if name == "" {
		return address
	}
	quoted := strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(name)
	return `"` + quoted + `" <` + address + `>`
}
