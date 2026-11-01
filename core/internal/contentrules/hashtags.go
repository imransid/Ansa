package contentrules

import (
	"regexp"
	"strings"

	"golang.org/x/text/unicode/norm"
)

// A draft's hashtags (the old lib/content-studio/hashtags.ts): stored
// without their "#", one word each, published as "#bread #lisbon".

// The most hashtags a draft holds (platforms take 10: a rule), and the
// longest hashtag.
const (
	DraftHashtagsMax = 30
	HashtagMaxLength = 60
)

// Letters of any script with their marks, digits and "_", but not digits
// alone: what the platforms turn into a link.
var (
	hashtagPattern = regexp.MustCompile(`^[\p{L}\p{M}\p{N}_]+$`)
	digitsOnly     = regexp.MustCompile(`^\p{N}+$`)
	typedSeparator = regexp.MustCompile(`[\s,]+`)
	spaces         = regexp.MustCompile(`\s+`)
)

// IsValidHashtag: one word that works as a hashtag (without its "#").
func IsValidHashtag(tag string) bool {
	return utf16Length(tag) <= HashtagMaxLength && hashtagPattern.MatchString(tag) && !digitsOnly.MatchString(tag)
}

// ReadTypedHashtags reads the editor's box ("#bread, #lisbon sourdough"):
// words separated by spaces or commas, each with or without its "#", each
// once (the first spelling stays); what can't be a hashtag is listed apart.
func ReadTypedHashtags(text string) (hashtags, invalid []string) {
	for _, word := range typedSeparator.Split(norm.NFC.String(text), -1) {
		tag := strings.TrimLeft(word, "#")
		switch {
		case tag == "":
		case IsValidHashtag(tag):
			hashtags = addOnce(hashtags, tag)
		default:
			invalid = append(invalid, word)
		}
	}
	return hashtags, invalid
}

// CleanModelHashtags are the AI's hashtags: "#" and spaces taken out, those
// that still can't be one left out, each once, at most DraftHashtagsMax.
func CleanModelHashtags(tags []string) []string {
	var kept []string
	for _, raw := range tags {
		tag := strings.TrimLeft(norm.NFC.String(CutRunsOfMarks(raw)), "#")
		tag = spaces.ReplaceAllString(tag, "")
		if IsValidHashtag(tag) {
			kept = addOnce(kept, tag)
		}
	}
	if len(kept) > DraftHashtagsMax {
		kept = kept[:DraftHashtagsMax]
	}
	return kept
}

func addOnce(list []string, tag string) []string {
	for _, existing := range list {
		if strings.EqualFold(existing, tag) {
			return list
		}
	}
	return append(list, tag)
}

// utf16Length counts as JavaScript's .length did (the old limits).
func utf16Length(text string) int {
	n := 0
	for _, r := range text {
		if r >= 0x10000 {
			n += 2
		} else {
			n++
		}
	}
	return n
}
