package analytics

import (
	"strings"
	"unicode/utf16"

	"ansa/core/internal/plaintext"
)

// Texts as the old code cleaned them: lengths in UTF-16 units and
// JavaScript's white space, so a review's texts are cut exactly where the
// old code cut them.

// cleanText is one plain line, cut at a word with "..." when too long (the
// old cutPlanText(toPlainSingleLine(text))). Lengths count UTF-16 units, as
// JavaScript's do; a cut never splits an emoji. WHY not before its middle:
// a text with few spaces (Chinese, Japanese) would otherwise say almost nothing.
func cleanText(text string, maxLength int) string {
	units := utf16.Encode([]rune(plaintext.SingleLine(text)))
	if len(units) <= maxLength {
		return string(utf16.Decode(units))
	}
	kept := units[:maxLength-len(planTextCutMarker)]
	if last := kept[len(kept)-1]; last >= 0xd800 && last <= 0xdbff {
		kept = kept[:len(kept)-1]
	}
	keptText := strings.TrimRightFunc(string(utf16.Decode(kept)), isJavaScriptSpace)
	kept = utf16.Encode([]rune(keptText))
	if lastSpace := lastSpaceIn(kept); lastSpace >= 0 && 2*lastSpace >= len(kept) {
		kept = kept[:lastSpace]
	}
	return strings.TrimRightFunc(string(utf16.Decode(kept)), isJavaScriptSpace) + planTextCutMarker
}

func lastSpaceIn(units []uint16) int {
	for index := len(units) - 1; index >= 0; index-- {
		if units[index] == ' ' {
			return index
		}
	}
	return -1
}

// trimLikeJavaScript trims what JavaScript's trim() does.
func trimLikeJavaScript(text string) string {
	return strings.TrimFunc(text, isJavaScriptSpace)
}

// isJavaScriptSpace: JavaScript's white space and line terminators.
func isJavaScriptSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}
