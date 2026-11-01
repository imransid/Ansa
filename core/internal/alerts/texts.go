package alerts

import (
	"html"
	"strings"

	"ansa/core/internal/assistant"
	"ansa/core/internal/plaintext"
)

// NeedsYou is one alert: who (as the channel gave the name), where, why,
// whether the holding reply reached them, and the link.
type NeedsYou struct {
	CustomerName     *string
	ChannelLabel     string
	Reason           string
	HoldingReplySent bool
	Link             string
}

// Rendered is an email's subject and both bodies.
type Rendered struct{ Subject, HTML, Text string }

// customer is the name as one plain line of at most 60 characters: the
// customer wrote it, so it is never trusted in a subject line.
func (n NeedsYou) customer() string {
	if n.CustomerName == nil {
		return "A customer"
	}
	name := []rune(plaintext.SingleLine(*n.CustomerName))
	if len(name) > 60 {
		name = name[:60]
	}
	if cleaned := strings.TrimSpace(string(name)); cleaned != "" {
		return cleaned
	}
	return "A customer"
}

// Email is the alert for one owner (the old lib/emails/needs-you.ts).
func (n NeedsYou) Email(ownerName string) Rendered {
	customer := n.customer()
	why := assistant.ReasonText[n.Reason]
	subject := []rune(customer + " needs you on " + n.ChannelLabel)
	if len(subject) > 150 {
		subject = subject[:150]
	}
	sent := "No reply reached them."
	if n.HoldingReplySent {
		sent = "ansa sent them your holding reply."
	}
	text := strings.Join([]string{"Hi " + ownerName + ",", "", customer + " needs you on " + n.ChannelLabel + ". " + why, "", sent, "", "Open the conversation: " + n.Link}, "\n")
	page := `<!doctype html>
<html>
  <body style="font-family: sans-serif; line-height: 1.5; color: #111;">
    <p>Hi ` + html.EscapeString(ownerName) + `,</p>
    <p><strong>` + html.EscapeString(customer) + `</strong> needs you on ` + html.EscapeString(n.ChannelLabel) + `. ` + html.EscapeString(why) + `</p>
    <p>` + html.EscapeString(sent) + `</p>
    <p><a href="` + html.EscapeString(n.Link) + `">Open the conversation</a></p>
  </body>
</html>`
	return Rendered{Subject: string(subject), HTML: page, Text: text}
}

// TelegramNote is the same alert as one short message from ansa's bot.
func (n NeedsYou) TelegramNote() string {
	return n.customer() + " needs you on " + n.ChannelLabel + ". " + assistant.ReasonText[n.Reason] + " Open: " + n.Link
}
