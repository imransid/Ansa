package inbound

import (
	"regexp"
	"strings"
	"unicode/utf8"

	"ansa/core/internal/plaintext"
	"ansa/core/internal/resend"
)

// How much of a received email is kept (the brain sees less).
const (
	maxSubject = 1_000
	maxBody    = 100_000
	cutNote    = "\n\n[The rest of this email was cut: it was longer than 100,000 characters.]"
)

var contentIDReference = regexp.MustCompile(`(?i)cid:([^"'\s<>()]+)`)

// Prepared is what the request keeps of an email.
type Prepared struct {
	Subject string
	// The plain-text part, or text made from the HTML part when there is none.
	Body string
	// There was no plain-text part, only HTML.
	BodyFromHTML bool
	// Files the customer attached (never stored: counted and named).
	AttachmentNames []string
	AttachmentCount int
	// Pictures the HTML shows inside the email (logos, pasted images).
	InlineImageCount int
}

// Prepare picks and caps what is kept.
func Prepare(c *resend.Content) Prepared {
	p := Prepared{Subject: cutRunes(c.Subject, maxSubject)}
	plain := ""
	if c.Text != nil && strings.TrimSpace(*c.Text) != "" {
		plain = *c.Text
	}
	htmlPart := ""
	if c.HTML != nil {
		htmlPart = *c.HTML
	}
	switch {
	case plain != "":
		p.Body = plain
	case strings.TrimSpace(htmlPart) != "":
		p.Body = HTMLToText(htmlPart, maxBody)
		p.BodyFromHTML = true
	}
	if utf8.RuneCountInString(p.Body) > maxBody {
		p.Body = string([]rune(p.Body)[:maxBody]) + cutNote
	}
	shown := map[string]bool{}
	for _, match := range contentIDReference.FindAllStringSubmatch(htmlPart, -1) {
		shown[strings.ToLower(match[1])] = true
	}
	for _, a := range c.Attachments {
		id := strings.ToLower(strings.TrimSuffix(strings.TrimPrefix(strings.TrimSpace(a.ContentID), "<"), ">"))
		if id != "" && shown[id] {
			p.InlineImageCount++
			continue
		}
		p.AttachmentCount++
		if name := cutRunes(plaintext.SingleLine(a.Filename), 200); name != "" && len(p.AttachmentNames) < 20 {
			p.AttachmentNames = append(p.AttachmentNames, name)
		}
	}
	return p
}
