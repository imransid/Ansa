// Package plaintext turns text written by a person, a customer or the AI
// into one plain line (the old lib/plain-text.ts toPlainSingleLine), for
// places where it is read exactly as it is: an email's subject or sender
// name, a ticket subject. Line breaks and other control characters become
// spaces, invisible format characters (a right-to-left override, a
// zero-width space) are removed, and runs of spaces become one.
package plaintext

import (
	"strings"
	"unicode"
)

// SingleLine cleans text into one plain line, trimmed.
func SingleLine(text string) string {
	var out strings.Builder
	pendingSpace := false
	for _, r := range text {
		switch {
		case unicode.Is(unicode.Cf, r):
			continue
		case unicode.IsControl(r) || r == '\u2028' || r == '\u2029' || unicode.IsSpace(r):
			pendingSpace = out.Len() > 0
		default:
			if pendingSpace {
				out.WriteByte(' ')
				pendingSpace = false
			}
			out.WriteRune(r)
		}
	}
	return out.String()
}
