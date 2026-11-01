package profile

import (
	"regexp"
	"strings"
	"unicode"
)

// The limits of the profile and the interview (the old lib/cofounder/limits.ts).
const (
	// One fact, confirmed or proposed. A line break counts once, as in the box.
	FactMaxLength = 2_000
	// One answer an owner types into the interview.
	AnswerMaxLength = 4_000
	// One question the AI asks (its own is cut to this).
	QuestionMaxLength = 500
)

// Proposal is a fact the AI proposes for one topic.
type Proposal struct {
	Topic string `json:"topic"`
	Value string `json:"value"`
}

// UTF16Length counts as the old JavaScript did (.length: UTF-16 units), so
// both backends cut and refuse at the same place.
func UTF16Length(text string) int {
	n := 0
	for _, r := range text {
		n++
		if r >= 0x10000 {
			n++
		}
	}
	return n
}

// CutToLength is the start of text, at most maxLength UTF-16 units, never
// ending inside a character (an emoji is two units: the API refuses half
// of one), with no spaces at its end once cut.
func CutToLength(text string, maxLength int) string {
	if UTF16Length(text) <= maxLength {
		return text
	}
	units := 0
	for index, r := range text {
		width := 1
		if r >= 0x10000 {
			width = 2
		}
		if units+width > maxLength {
			return strings.TrimRightFunc(text[:index], unicode.IsSpace)
		}
		units += width
	}
	return text
}

var threeOrMoreLineBreaks = regexp.MustCompile(`\n{3,}`)

// CleanFactValue is a value as a fact holds it: line breaks as \n, no
// control characters but line breaks and tabs (Postgres refuses NUL), at
// most one blank line in a row, no spaces at the ends, at most 2,000.
func CleanFactValue(text string) string {
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
	text = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return -1
		}
		return r
	}, text)
	text = strings.TrimSpace(threeOrMoreLineBreaks.ReplaceAllString(text, "\n\n"))
	return CutToLength(text, FactMaxLength)
}

// CheckProposals keeps the AI's proposals that may be saved: a topic of
// ours, a value left after cleaning; one per topic (a later one is a
// correction). The brain read them already; core checks again.
func CheckProposals(given []Proposal) []Proposal {
	valueByTopic := map[string]string{}
	var order []string
	for _, proposal := range given {
		if _, known := FindTopic(proposal.Topic); !known {
			continue
		}
		value := CleanFactValue(proposal.Value)
		if value == "" {
			continue
		}
		if _, seen := valueByTopic[proposal.Topic]; !seen {
			order = append(order, proposal.Topic)
		}
		valueByTopic[proposal.Topic] = value
	}
	kept := []Proposal{}
	for _, topic := range order {
		kept = append(kept, Proposal{Topic: topic, Value: valueByTopic[topic]})
	}
	return kept
}

// FormText reads text typed in a box with several lines: a line break
// stored as \n and counted once, trimmed. problem is the words to show
// under the box ("" = fine): empty, longer than maxLength, or holding a
// control character other than a line break or a tab.
func FormText(text string, maxLength int, emptyProblem, tooLongProblem string) (string, string) {
	text = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n"))
	switch {
	case text == "":
		return text, emptyProblem
	case UTF16Length(text) > maxLength:
		return text, tooLongProblem
	case strings.ContainsFunc(text, func(r rune) bool { return unicode.IsControl(r) && r != '\n' && r != '\t' }):
		return text, "Remove the invisible control characters from the text."
	}
	return text, ""
}

// ShownValue is a value a page showed and sends back: only a claim, its
// line breaks as \n ("" = none). Store functions compare it with the
// stored one; a difference means someone changed it meanwhile.
func ShownValue(text string) string {
	return strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
}
