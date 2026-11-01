package knowledge

import (
	"strings"
	"unicode"
)

// The pieces the search indexes and the AI reads (the old
// lib/knowledge/chunking.ts): at most 1,500 characters each, whole
// paragraphs where they fit. Pure: the same text always gives the same pieces.
const chunkMax = 1_500

// ChunkBody is one article body's pieces.
func ChunkBody(body string) []string {
	return PackParagraphs(body, chunkMax)
}

// PackParagraphs packs whole paragraphs into pieces of at most maxLength
// characters, joined by a blank line. A longer paragraph is cut into pieces
// of its own: between sentences, else between words, else anywhere. Never an
// empty piece, none starting or ending with spaces or line breaks.
func PackParagraphs(text string, maxLength int) []string {
	var pieces []string
	current := ""
	for _, paragraph := range splitParagraphs(text) {
		if length(paragraph) > maxLength {
			if current != "" {
				pieces = append(pieces, current)
				current = ""
			}
			pieces = append(pieces, cutLongParagraph(paragraph, maxLength)...)
			continue
		}
		joined := paragraph
		if current != "" {
			joined = current + "\n\n" + paragraph
		}
		if length(joined) <= maxLength {
			current = joined
		} else {
			pieces = append(pieces, current)
			current = paragraph
		}
	}
	if current != "" {
		pieces = append(pieces, current)
	}
	return pieces
}

// splitParagraphs is the text between blank lines (lines of only spaces
// count as blank), each trimmed; line breaks inside a paragraph stay.
func splitParagraphs(text string) []string {
	var paragraphs, lines []string
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
	for _, line := range strings.Split(text, "\n") {
		if strings.TrimSpace(line) != "" {
			lines = append(lines, line)
			continue
		}
		if len(lines) > 0 {
			paragraphs = append(paragraphs, strings.TrimSpace(strings.Join(lines, "\n")))
			lines = nil
		}
	}
	if len(lines) > 0 {
		paragraphs = append(paragraphs, strings.TrimSpace(strings.Join(lines, "\n")))
	}
	return paragraphs
}

// cutLongParagraph cuts one trimmed paragraph into pieces of at most maxLength.
func cutLongParagraph(paragraph string, maxLength int) []string {
	var pieces []string
	rest := []rune(paragraph)
	for len(rest) > maxLength {
		at := findCut(rest, maxLength)
		pieces = append(pieces, strings.TrimRightFunc(string(rest[:at]), unicode.IsSpace))
		rest = []rune(strings.TrimLeftFunc(string(rest[at:]), unicode.IsSpace))
	}
	if len(rest) > 0 {
		pieces = append(pieces, string(rest))
	}
	return pieces
}

// findCut is where to cut text longer than maxLength: after the last
// sentence that ends within it (". ", "! ", "? ", also after a closing quote
// or bracket), else at the last space, else at maxLength. Always above 0.
func findCut(text []rune, maxLength int) int {
	window := text[:min(len(text), maxLength+1)]
	sentenceEnd := 0
	for i, r := range window {
		if r != '.' && r != '!' && r != '?' {
			continue
		}
		end := i + 1
		for end < len(window) && strings.ContainsRune(`"'”’)]`, window[end]) {
			end++
		}
		if end < len(window) && unicode.IsSpace(window[end]) {
			sentenceEnd = end
		}
	}
	if sentenceEnd > 0 {
		return sentenceEnd
	}
	for i := min(maxLength, len(window)-1); i > 0; i-- {
		if unicode.IsSpace(window[i]) {
			return i
		}
	}
	return maxLength
}

// length counts characters (Postgres's char_length).
func length(text string) int {
	return len([]rune(text))
}
