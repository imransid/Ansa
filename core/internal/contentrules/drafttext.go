package contentrules

import (
	"regexp"
	"strings"
	"unicode"
)

// The texts of a content draft as they are saved (the old lib/content-
// studio/draft-text.ts): the API's forms and the AI's answer are cleaned here.

// CombiningMarksMaxRun is Unicode's bound for text that is safe to work with
// (UAX #15, "Stream-Safe Text Format"): at most 30 combining marks in a
// row. WHY: counting a text and finding the words to avoid normalize it,
// which takes time growing with the square of a run's length.
const CombiningMarksMaxRun = 30

// isMark: a combining mark, or one of the two half-width sound marks
// (U+FF9E, U+FF9F), which NFKC makes combining marks.
func isMark(r rune) bool {
	return unicode.Is(unicode.M, r) || r == 0xFF9E || r == 0xFF9F
}

// HasTooManyMarksInARow: more than 30 marks in a row (a person's text is refused).
func HasTooManyMarksInARow(text string) bool {
	run := 0
	for _, r := range text {
		if !isMark(r) {
			run = 0
			continue
		}
		run++
		if run > CombiningMarksMaxRun {
			return true
		}
	}
	return false
}

// CutRunsOfMarks cuts each run of marks to 30 (the AI's text is cleaned, not refused).
func CutRunsOfMarks(text string) string {
	var out strings.Builder
	run := 0
	for _, r := range text {
		if isMark(r) {
			run++
			if run > CombiningMarksMaxRun {
				continue
			}
		} else {
			run = 0
		}
		out.WriteRune(r)
	}
	return out.String()
}

var runOfWhitespace = regexp.MustCompile(`\s+`)

// CleanDraftLine is one line of a draft (topic, pillar, campaign, a YouTube
// title, the call to action) as saved: line breaks become spaces, runs of
// spaces one, nothing blank at the ends, no hidden format characters except
// the joiners and tag characters writing needs (Persian spelling, emoji such
// as the woman cook, Scotland's flag): a title is published as written.
func CleanDraftLine(text string) string {
	var out strings.Builder
	for _, r := range text {
		switch {
		case unicode.Is(unicode.Cc, r) || r == ' ' || r == ' ':
			out.WriteByte(' ')
		case unicode.Is(unicode.Cf, r) && r != 0x200C && r != 0x200D && !(r >= 0xE0020 && r <= 0xE007F):
		default:
			out.WriteRune(r)
		}
	}
	return strings.TrimSpace(runOfWhitespace.ReplaceAllString(out.String(), " "))
}

// CleanDraftLines is several lines (the text, the image description, the
// video script, a rejection note) as saved: line breaks as \n, nothing
// blank at the ends.
func CleanDraftLines(text string) string {
	return strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n"))
}
