// Package contentrules is what a post may say and how long it may be (the
// old lib/content-rules.ts and lib/content-studio/words-to-avoid.ts). Today
// it holds Facebook's rules, the ones "Post for me" and the publishing queue
// check; LinkedIn's, X's and YouTube's move with the content studio.
package contentrules

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// Facebook's limits: the published text (body, call to action, hashtags,
// each its own paragraph) in characters, and hashtags.
const (
	FacebookTextMax     = 63_206
	FacebookHashtagsMax = 10
)

// Post is what a post publishes.
type Post struct {
	Body, CallToAction string
	Hashtags           []string
}

// PublishedText is the text as it goes out: body, call to action and
// hashtags ("#tag" each), each its own paragraph.
func PublishedText(p Post) string {
	var parts []string
	for _, part := range []string{strings.TrimSpace(p.Body), strings.TrimSpace(p.CallToAction)} {
		if part != "" {
			parts = append(parts, part)
		}
	}
	if len(p.Hashtags) > 0 {
		tags := make([]string, len(p.Hashtags))
		for i, tag := range p.Hashtags {
			tags[i] = "#" + tag
		}
		parts = append(parts, strings.Join(tags, " "))
	}
	return strings.Join(parts, "\n\n")
}

// FacebookProblems are the blocking problems of a Facebook text post: too
// long, too many hashtags, a word to avoid ("" = none). A post with any is never sent.
func FacebookProblems(p Post, wordsToAvoid []string) []string {
	var problems []string
	if utf8.RuneCountInString(PublishedText(p)) > FacebookTextMax {
		problems = append(problems, "text_too_long")
	}
	if len(p.Hashtags) > FacebookHashtagsMax {
		problems = append(problems, "too_many_hashtags")
	}
	if len(FindWordsToAvoid(PublishedText(p), wordsToAvoid)) > 0 {
		problems = append(problems, "word_to_avoid")
	}
	return problems
}

// A fact that only says there are none ("None.", "n/a"). English only.
var saysNone = map[string]bool{"none": true, "no": true, "nothing": true, "n/a": true, "na": true, "not really": true, "nothing specific": true, "no restrictions": true}

var listMarker = regexp.MustCompile(`^(?:[-*•–—]|\d+[.)])\s*`)
var leadingQuotes = regexp.MustCompile(`^["'“”‘’«»„]+`)
var trailingMarks = regexp.MustCompile(`["'“”‘’«»„.!?:]+$`)
var runOfSpaces = regexp.MustCompile(`\s+`)

func cleanTerm(piece string) string {
	piece = listMarker.ReplaceAllString(strings.TrimSpace(piece), "")
	piece = trailingMarks.ReplaceAllString(leadingQuotes.ReplaceAllString(piece, ""), "")
	return strings.TrimSpace(runOfSpaces.ReplaceAllString(piece, " "))
}

// ReadWordsToAvoid reads the "Words to avoid" fact an owner typed: split at
// line breaks, commas and semicolons, each piece without its list marker,
// quotes and end punctuation; 2-100 characters; at most 100; "None." = none.
func ReadWordsToAvoid(fact string) []string {
	fact = norm.NFKC.String(fact)
	if fact == "" || saysNone[strings.ToLower(cleanTerm(fact))] {
		return nil
	}
	var terms []string
	seen := map[string]bool{}
	for _, piece := range regexp.MustCompile(`[\n,;]+`).Split(fact, -1) {
		term := cleanTerm(piece)
		length := utf8.RuneCountInString(term)
		if length >= 2 && length <= 100 && !seen[strings.ToLower(term)] && len(terms) < 100 {
			seen[strings.ToLower(term)] = true
			terms = append(terms, term)
		}
	}
	return terms
}

// FindWordsToAvoid is the terms the text uses, each as a whole word or
// phrase in any case ("cheap" finds "Cheap!" and "#cheap", never "cheapest").
func FindWordsToAvoid(text string, terms []string) []string {
	text = norm.NFKC.String(text)
	var found []string
	for _, term := range terms {
		words := strings.Fields(term)
		for i, word := range words {
			words[i] = regexp.QuoteMeta(word)
		}
		pattern, err := regexp.Compile(`(?i)` + strings.Join(words, `\s+`))
		if err != nil {
			continue
		}
		for _, match := range pattern.FindAllStringIndex(text, -1) {
			if !wordCharacterBefore(text, match[0]) && !wordCharacterAfter(text, match[1]) {
				found = append(found, term)
				break
			}
		}
	}
	return found
}

func isWordCharacter(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsMark(r) || unicode.IsDigit(r) || unicode.IsNumber(r)
}

func wordCharacterBefore(text string, at int) bool {
	r, size := utf8.DecodeLastRuneInString(text[:at])
	return size > 0 && isWordCharacter(r)
}

func wordCharacterAfter(text string, at int) bool {
	r, size := utf8.DecodeRuneInString(text[at:])
	return size > 0 && isWordCharacter(r)
}
