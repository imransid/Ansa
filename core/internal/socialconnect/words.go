package socialconnect

import (
	"strconv"
	"strings"

	"ansa/core/internal/contentrules"
)

// The Accounts page's words: a connection's problem, what ansa publishes
// to a platform, and its text limit.

// describeConnectionError is the Accounts page's words for a connection's
// last error (the old lib/social-errors.ts). A code this version doesn't
// know (written by a later one) is shown as it is.
func describeConnectionError(code, label string) string {
	switch code {
	case "token_expired":
		return label + "'s permission ran out (it lasts 60 days and can't be renewed without you). Reconnect to keep posting."
	case "refresh_expired":
		return label + "'s permission ran out. Reconnect to keep posting."
	case "refresh_refused":
		return label + " no longer accepts ansa's permission (it may have been removed in " + label + "'s settings). Reconnect to keep posting."
	case "refresh_unavailable":
		return label + " didn't answer when ansa last renewed its permission. ansa tries again the next time it needs it."
	case "token_rejected":
		return label + " refused ansa's permission the last time it was used. Reconnect to keep posting."
	}
	return "Something went wrong the last time ansa used it (" + code + ")."
}

var formatPlurals = map[string]string{"post": "text posts", "image_post": "posts with an image", "video": "videos"}

// describePublishedFormats is "Text posts and posts with an image", or "Videos only".
func describePublishedFormats(platform string) string {
	names := []string{}
	for _, format := range contentrules.PublishedFormats[platform] {
		names = append(names, formatPlurals[format])
	}
	sentence := names[0] + " only"
	if len(names) > 1 {
		sentence = strings.Join(names[:len(names)-1], ", ") + " and " + names[len(names)-1]
	}
	return strings.ToUpper(sentence[:1]) + sentence[1:]
}

var countingUnits = map[string]string{contentrules.CountingX: "characters as X counts them", contentrules.CountingCharacters: "characters", contentrules.CountingUTF8Bytes: "bytes"}

// describeTextLimit comes from the content rules, so both agree.
func describeTextLimit(platform string) string {
	rules := contentrules.PlatformRules[platform]
	text := rules.TextLabel + ": up to " + withThousands(rules.TextMax) + " " + countingUnits[rules.TextCounting]
	if rules.TitleMax > 0 {
		return "Title: up to " + strconv.Itoa(rules.TitleMax) + " characters. " + text + "."
	}
	return text + "."
}

// withThousands writes 63206 as "63,206" (en-US).
func withThousands(n int) string {
	digits := strconv.Itoa(n)
	for i := len(digits) - 3; i > 0; i -= 3 {
		digits = digits[:i] + "," + digits[i:]
	}
	return digits
}
