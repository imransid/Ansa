package main

import "strings"

// The made-up customer emails of `inbound-email` (the old
// scripts/simulate-inbound-email.ts), in the shape of Resend's Receiving
// API, which core's .dev-inbound stand-in reads. Like Resend, `from` is the
// bare address and the display name is only in headers.from.

var inboundVariants = []string{"valid", "unauthenticated", "cc", "typed-only", "auto-reply", "newsletter", "html-only", "contact-form", "odd-sender", "thread-reply", "unsigned"}

// An address a company types on its Setup page: it never decides the company.
const typedSupportAddress = "support@yourcompany.example"

// inboundRecipients is who the webhook says the email was for.
func inboundRecipients(variant, forwardingAddress string) (to, cc []string) {
	switch variant {
	case "cc":
		return []string{typedSupportAddress}, []string{forwardingAddress}
	case "typed-only":
		return []string{typedSupportAddress}, []string{}
	}
	return []string{forwardingAddress}, []string{}
}

// inboundContent is what the email holds, per variant.
func inboundContent(variant string, to []string) map[string]any {
	checks := map[string]string{"spf": "pass", "dkim": "pass", "dmarc": "pass"}
	if variant == "unauthenticated" {
		checks = map[string]string{"spf": "fail", "dkim": "fail", "dmarc": "fail"}
	}
	headers := map[string]string{"from": "Sam Okafor <sam.okafor@example.com>"}
	content := map[string]any{
		"from": "sam.okafor@example.com", "to": to, "reply_to": []string{},
		"subject":     "Where is my order #48213?",
		"text":        "Hi,\n\nI ordered a monitor two weeks ago and it still hasn't arrived. Can you check?\n\nThanks,\nSam",
		"html":        nil,
		"attachments": []any{},
		"headers":     headers, "authentication": checks,
	}
	switch variant {
	case "auto-reply":
		headers["Auto-Submitted"] = "auto-replied"
	case "newsletter":
		headers["List-Unsubscribe"] = "<https://news.example.com/unsubscribe>"
	case "html-only":
		content["text"] = nil
		content["html"] = `<html><head><style>p{color:red}</style></head><body><p>Hi,</p><p>The monitor arrived <b>broken</b>. Photos attached.</p><p>Sam</p><img src="cid:logo@sam.example"></body></html>`
		content["attachments"] = []map[string]string{{"filename": "front.jpg"}, {"filename": "box.jpg"}, {"filename": "logo.png", "content_id": "<logo@sam.example>"}}
	case "contact-form":
		content["from"] = "noreply@forms.example.com"
		headers["from"] = "Website form <noreply@forms.example.com>"
		content["reply_to"] = []string{"Ana Lima <ana.lima@example.com>"}
	case "odd-sender":
		content["from"] = "ivan@почта.рф"
		headers["from"] = `"Ivan \"The Customer\" Petrov" <ivan@почта.рф>`
	case "thread-reply":
		content["subject"] = "RE: Your order #48213"
		content["text"] = threadReplyText
	}
	return content
}

// An Outlook reply with a "-- " signature above an earlier message that
// names other people: the AI's summary is only about the refund question.
var threadReplyText = strings.Join([]string{
	"Hi, I sent the monitor back last week. When do I get my refund?",
	"",
	"-- ",
	"Sam Okafor | Head of Purchasing, Example Ltd | +1 555 0100",
	"",
	"From: Jane Doe <jane.doe@shop.example>",
	"Sent: Monday, October 12, 2026 10:00 AM",
	"To: Sam Okafor <sam.okafor@example.com>; Bob Roe <bob.roe@other.example>",
	"Subject: Your order #48213",
	"",
	"Hello Sam, Bob Roe from our warehouse will collect the keyboard on Friday.",
}, "\r\n")
