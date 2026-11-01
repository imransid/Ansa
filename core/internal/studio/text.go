package studio

import (
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"ansa/core/internal/contentrules"
	"ansa/core/internal/drafts"
	"ansa/core/internal/plaintext"
)

// The texts of a draft as the forms send them and as the AI writes them
// (the old lib/validation/content-drafts.ts and draft-answer.ts). Lengths
// count as the old JavaScript did (UTF-16 units), so both backends accept
// and cut the same texts.

const tooManyMarks = "Take out some accents or other marks: at most 30 can follow each other."

// oneLine is one line of a draft (topic, pillar, campaign, title, call to
// action) as saved, or why it can't be.
func oneLine(text string, max int, label string) (string, string) {
	cleaned := contentrules.CleanDraftLine(text)
	if utf16Length(cleaned) > max {
		return "", label + " can be at most " + withThousands(max) + " characters."
	}
	if contentrules.HasTooManyMarksInARow(cleaned) {
		return "", tooManyMarks
	}
	return cleaned, ""
}

// severalLines is a text of several lines (the text, the image
// description, the video script, a note): a line break counting once.
func severalLines(text string, max int, label string) (string, string) {
	cleaned := contentrules.CleanDraftLines(text)
	if utf16Length(cleaned) > max {
		return "", label + " can be at most " + withThousands(max) + " characters."
	}
	for _, r := range cleaned {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return "", "Remove the invisible control characters from the text."
		}
	}
	if contentrules.HasTooManyMarksInARow(cleaned) {
		return "", tooManyMarks
	}
	return cleaned, ""
}

// hashtagsBox reads the editor's hashtag box ("#bread #lisbon"): each one
// word of letters, digits or "_", at most 30.
func hashtagsBox(text string) ([]string, string) {
	text = cutUTF16(text, 5_000, false)
	if contentrules.HasTooManyMarksInARow(text) {
		return nil, tooManyMarks
	}
	hashtags, invalid := contentrules.ReadTypedHashtags(text)
	if len(invalid) > 0 {
		return nil, "Not a hashtag: " + strings.Join(invalid[:min(3, len(invalid))], " ") + ". A hashtag is one word of letters, digits or _."
	}
	if len(hashtags) > contentrules.DraftHashtagsMax {
		return nil, "A draft can hold at most 30 hashtags."
	}
	if hashtags == nil {
		hashtags = []string{}
	}
	return hashtags, ""
}

var threeLineBreaks = regexp.MustCompile(`\n{3,}`)

// cleanModelLines is the AI's text of several lines as a draft holds it:
// line breaks as \n, no control characters but line breaks and tabs, at
// most one blank line in a row, no spaces at the ends, no more marks in a
// row than a person may type, cut to max.
func cleanModelLines(text string, max int) string {
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
	text = strings.Map(func(r rune) rune {
		if unicode.Is(unicode.Cc, r) && r != '\n' && r != '\t' {
			return -1
		}
		return r
	}, text)
	text = trimJS(threeLineBreaks.ReplaceAllString(text, "\n\n"))
	return cutUTF16(contentrules.CutRunsOfMarks(text), max, true)
}

// cleanModelLine is the AI's one line as a draft holds it, cut to max.
func cleanModelLine(text string, max int) string {
	return cutUTF16(contentrules.CutRunsOfMarks(contentrules.CleanDraftLine(text)), max, true)
}

// cleanClaimText is one claim the AI listed: one plain line of at most 500.
func cleanClaimText(text string) string {
	return cutUTF16(plaintext.SingleLine(text), drafts.ClaimTextMax, true)
}

// utf16Length counts as JavaScript's .length does.
func utf16Length(text string) int {
	n := 0
	for _, r := range text {
		n++
		if r >= 0x10000 {
			n++
		}
	}
	return n
}

// cutUTF16 keeps at most max UTF-16 units, never half a character (the
// API refuses half an emoji); trimEnd also takes spaces off the end.
func cutUTF16(text string, max int, trimEnd bool) string {
	if utf16Length(text) <= max {
		return text
	}
	n := 0
	for i, r := range text {
		size := 1
		if r >= 0x10000 {
			size = 2
		}
		if n+size > max {
			text = text[:i]
			break
		}
		n += size
	}
	if trimEnd {
		return strings.TrimRightFunc(text, isJSSpace)
	}
	return text
}

// trimJS trims what JavaScript's trim() does.
func trimJS(text string) string {
	return strings.TrimFunc(text, isJSSpace)
}

func isJSSpace(r rune) bool {
	return (unicode.IsSpace(r) && r != 0x85) || r == 0xFEFF
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
