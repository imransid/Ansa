// Package plaintext turns text written by a person, a customer or the AI
// into one plain line (the old lib/plain-text.ts toPlainSingleLine), for
// places where it is read exactly as it is: an email's subject or sender
// name, a ticket subject. Line breaks and other control characters become
// spaces, invisible format characters (a right-to-left override, a
// zero-width space) are removed, and runs of spaces become one.
package plaintext

import (
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
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

// Note cleans text typed in a box with several lines (the old
// multilineNote): a line break stored as "\n" and counted once, trimmed,
// at most max characters, no control characters but line breaks and tabs
// (Postgres refuses a NUL). It returns the text, or the words that say
// what is wrong.
func Note(text string, max int) (string, string) {
	text = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n"))
	if utf8.RuneCountInString(text) > max {
		return "", "At most " + withThousands(max) + " characters."
	}
	for _, r := range text {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return "", "Remove the invisible control characters from the text."
		}
	}
	return text, ""
}

func withThousands(n int) string {
	digits := strconv.Itoa(n)
	var out strings.Builder
	for i, r := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			out.WriteByte(',')
		}
		out.WriteRune(r)
	}
	return out.String()
}
