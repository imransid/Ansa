package contentrules

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// MeasureText is a text's length counted the platform's way, in its
// composed form (NFC): an accent typed as a separate mark counts with its
// letter, as the platforms do.
func MeasureText(text, counting string) int {
	composed := composed(text)
	switch counting {
	case CountingX:
		return CountX(composed)
	case CountingUTF8Bytes:
		return len(composed)
	}
	return utf8.RuneCountInString(composed)
}

// composed is the text in NFC as JavaScript's normalize("NFC") makes it.
// Go's NFC also follows Unicode's stream-safe format, adding a U+034F
// after 30 marks in a row; JavaScript doesn't, so one it added is taken out
// (a person's text never has such a run: it is refused before it is saved).
func composed(text string) string {
	result := norm.NFC.String(text)
	if strings.Count(result, "\u034f") > strings.Count(text, "\u034f") && !strings.Contains(text, "\u034f") {
		result = strings.ReplaceAll(result, "\u034f", "")
	}
	return result
}

// What X counts for any link (it shortens every link), and the
// punctuation that ends a sentence rather than a link.
const xLinkLength = 23

var sentencePunctuation = ".,!?;:)]}'\"\u2019\u201d"

// A link as the old code found one, anywhere in the text: http://, https://
// or www. and everything up to the next space (JavaScript's \s, written out).
var xLink = regexp.MustCompile(`(?i)(?:https?://|www\.)[^\t\n\v\f\r \x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]+`)

// CountX is a text's length as X counts it (the old lib/content-studio/
// x-length.ts, after twitter-text's "v3" weights): most letters of Latin,
// Greek, Cyrillic, Hebrew, Arabic and the Indic scripts count 1; Chinese,
// Japanese, Korean and most symbols 2; an emoji 2 however many code points
// make it; every link 23. APPROXIMATED as the old code was: a link starts
// with http://, https:// or www. (X also shortens a bare "example.com"),
// and an emoji is a grapheme holding a pictographic or flag character.
func CountX(text string) int {
	count := 0
	withoutLinks := xLink.ReplaceAllStringFunc(composed(text), func(link string) string {
		// The link counts 23; the punctuation after it stays, to be counted as text.
		count += xLinkLength
		return trailingPunctuation(link)
	})
	for _, cluster := range graphemes(withoutLinks) {
		count += clusterWeight(cluster)
	}
	return count
}

// trailingPunctuation is the punctuation a link ends with, read from its
// end (a regular expression took time growing with the square of a run).
func trailingPunctuation(link string) string {
	end := len(link)
	for end > 0 {
		r, size := utf8.DecodeLastRuneInString(link[:end])
		if !strings.ContainsRune(sentencePunctuation, r) {
			break
		}
		end -= size
	}
	return link[end:]
}

// clusterWeight: an emoji counts 2; anything else is the sum of its
// characters' weights (1 for the ranges X counts as one, else 2).
func clusterWeight(cluster []rune) int {
	weight := 0
	for _, r := range cluster {
		if isPictographic(r) || isRegionalIndicator(r) {
			return 2
		}
		if countsAsOne(r) {
			weight++
		} else {
			weight += 2
		}
	}
	return weight
}

// The code points X counts as one character each: up to U+10FF, spaces
// of other widths and the zero-width joiner, dashes and quotation marks, primes.
func countsAsOne(r rune) bool {
	return r <= 0x10FF || (r >= 0x2000 && r <= 0x200D) || (r >= 0x2010 && r <= 0x201F) || (r >= 0x2032 && r <= 0x2037)
}

func isRegionalIndicator(r rune) bool { return r >= 0x1F1E6 && r <= 0x1F1FF }

func isPictographic(r rune) bool {
	low, high := 0, len(pictographic)
	for low < high {
		middle := (low + high) / 2
		switch {
		case r < pictographic[middle][0]:
			high = middle
		case r > pictographic[middle][1]:
			low = middle + 1
		default:
			return true
		}
	}
	return false
}

// graphemes cuts a text into what a reader sees as one character, close
// to Unicode's rules (UAX #29) where they matter for counting: marks,
// variation selectors, skin tones, tags and joiners stay with the character
// before them; emoji joined by a zero-width joiner are one; flags are pairs
// of regional indicators. (Hangul jamo and "prepend" marks may split
// differently; their weights add up the same.)
func graphemes(text string) [][]rune {
	runes := []rune(text)
	var clusters [][]rune
	for i := 0; i < len(runes); {
		start := i
		base := runes[i]
		i++
		if unicode.IsControl(base) {
			clusters = append(clusters, runes[start:i])
			continue
		}
		if isRegionalIndicator(base) && i < len(runes) && isRegionalIndicator(runes[i]) {
			i++
		}
		pictographicSoFar := isPictographic(base)
		for i < len(runes) {
			r := runes[i]
			if extendsCluster(r) {
				i++
				continue
			}
			if r == 0x200D {
				i++
				if pictographicSoFar && i < len(runes) && isPictographic(runes[i]) {
					i++
				}
				continue
			}
			break
		}
		clusters = append(clusters, runes[start:i])
	}
	return clusters
}

// extendsCluster: a mark, a variation selector, a skin tone, a tag
// character or the zero-width non-joiner.
func extendsCluster(r rune) bool {
	return unicode.In(r, unicode.Mn, unicode.Me, unicode.Mc) || (r >= 0xFE00 && r <= 0xFE0F) || (r >= 0x1F3FB && r <= 0x1F3FF) ||
		(r >= 0xE0020 && r <= 0xE007F) || r == 0x200C
}
