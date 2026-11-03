package mediagen

import (
	"image"
	"image/color"
	"image/draw"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// How the prompt's first words are laid out on the stand-in's picture:
// inside a margin, on at most standInMaxLines lines, each font pixel a
// square of the largest size at which the words fit, from
// standInLargestScale down to standInSmallestScale pixels.
const (
	standInMargin        = 112
	standInMaxLines      = 5
	standInLargestScale  = 16
	standInSmallestScale = 8
	// A letter and the space after it, and a line (tails included) and the
	// space under it, in font pixels.
	letterAdvance = glyphWidth + 1
	lineGap       = 2
	lineAdvance   = glyphHeight + lineGap
	// More of a prompt than the lines can ever hold.
	standInPromptCut = 400
)

// Quotes and dashes phones type, as the font's own.
var plainPunctuation = strings.NewReplacer("‘", "'", "’", "'", "“", `"`, "”", `"`, "–", "-", "—", "-")

// drawableWords are the prompt's first words as the font can write them:
// accents dropped ("ragù" becomes "ragu"), any other character the font
// lacks left out (an emoji, another script), and words left empty dropped.
func drawableWords(prompt string) []string {
	runes := []rune(prompt)
	if len(runes) > standInPromptCut {
		runes = runes[:standInPromptCut]
	}
	// NFKD splits a letter from its accent, which the font then leaves out.
	text := norm.NFKD.String(plainPunctuation.Replace(string(runes)))
	var kept strings.Builder
	for _, letter := range text {
		if unicode.IsSpace(letter) {
			kept.WriteRune(' ')
		} else if hasGlyph(letter) {
			kept.WriteRune(letter)
		}
	}
	return strings.Fields(kept.String())
}

// layOutWords picks the largest scale at which every word fits whole, and
// the lines the words make at it. Words that fit at no scale are written at
// the smallest as far as the lines go (a word longer than a line cut), the
// last line ending in "...".
func layOutWords(words []string) (int, []string) {
	for scale := standInLargestScale; scale > standInSmallestScale; scale-- {
		length := lettersPerLine(scale)
		if lines, allFit := wrapWords(words, length, linesFitting(scale)); allFit && longestWord(words) <= length {
			return scale, lines
		}
	}
	scale := standInSmallestScale
	lines, allFit := wrapWords(words, lettersPerLine(scale), linesFitting(scale))
	if !allFit {
		lines[len(lines)-1] = withEllipsis(lines[len(lines)-1], lettersPerLine(scale))
	}
	return scale, lines
}

// longestWord: how many letters the longest word has.
func longestWord(words []string) int {
	longest := 0
	for _, word := range words {
		longest = max(longest, len(word))
	}
	return longest
}

// lettersPerLine: how many letters one line holds at this scale (the last
// letter needs no space after it).
func lettersPerLine(scale int) int {
	return (standInSide - 2*standInMargin + scale) / (letterAdvance * scale)
}

// linesFitting: how many lines fit at this scale (the last needs no gap
// under it), at most standInMaxLines.
func linesFitting(scale int) int {
	return min(standInMaxLines, (standInSide-2*standInMargin+lineGap*scale)/(lineAdvance*scale))
}

// wrapWords fills lines of at most `length` letters with the words in
// turn, cutting a word longer than a line; false when they need more than
// maxLines (the first maxLines come back). Every letter the font has is one
// byte (ASCII), so a length in bytes is one in letters.
func wrapWords(words []string, length, maxLines int) ([]string, bool) {
	var lines []string
	line := ""
	for _, word := range splitLongWords(words, length) {
		switch {
		case line == "":
			line = word
		case len(line)+1+len(word) <= length:
			line += " " + word
		default:
			lines = append(lines, line)
			line = word
		}
	}
	if line != "" {
		lines = append(lines, line)
	}
	if len(lines) > maxLines {
		return lines[:maxLines], false
	}
	return lines, true
}

// splitLongWords cuts each word longer than a line into pieces that fit.
func splitLongWords(words []string, length int) []string {
	var pieces []string
	for _, word := range words {
		for len(word) > length {
			pieces = append(pieces, word[:length])
			word = word[length:]
		}
		pieces = append(pieces, word)
	}
	return pieces
}

// withEllipsis ends a line with "...", cutting its end to make room.
func withEllipsis(line string, length int) string {
	if len(line)+3 > length {
		line = strings.TrimRight(line[:length-3], " ")
	}
	return line + "..."
}

// writeLines writes the lines centred on the picture (from the top of the
// first to the baseline of the last), each font pixel a square of scale x
// scale pixels.
func writeLines(picture *image.RGBA, lines []string, scale int, ink color.RGBA) {
	paint := image.NewUniform(ink)
	height := ((len(lines)-1)*lineAdvance + glyphBaseline) * scale
	top := (standInSide - height) / 2
	for index, line := range lines {
		width := (len(line)*letterAdvance - 1) * scale
		corner := image.Pt((standInSide-width)/2, top+index*lineAdvance*scale)
		writeLine(picture, line, corner, scale, paint)
	}
}

// writeLine writes one line from its top left corner.
func writeLine(picture *image.RGBA, line string, corner image.Point, scale int, paint image.Image) {
	for position, letter := range []rune(line) {
		writeGlyph(picture, letter, corner.Add(image.Pt(position*letterAdvance*scale, 0)), scale, paint)
	}
}

// writeGlyph draws one letter's pixels from its top left corner.
func writeGlyph(picture *image.RGBA, letter rune, corner image.Point, scale int, paint image.Image) {
	for row, cells := range glyph(letter) {
		for column, cell := range cells {
			if cell != '#' {
				continue
			}
			pixel := image.Rect(column*scale, row*scale, (column+1)*scale, (row+1)*scale).Add(corner)
			draw.Draw(picture, pixel, paint, image.Point{}, draw.Src)
		}
	}
}
