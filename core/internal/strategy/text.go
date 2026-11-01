package strategy

import (
	"strings"
	"unicode"

	"ansa/core/internal/profile"
)

const cutMarker = "..."

// CutPlanText is text at most maxLength UTF-16 units long (as the old
// JavaScript counted). A longer one is cut at the last space before the
// limit and marked "...". WHY not before its middle: a text with few
// spaces (Chinese, Japanese) would otherwise say almost nothing.
func CutPlanText(text string, maxLength int) string {
	if profile.UTF16Length(text) <= maxLength {
		return text
	}
	kept := profile.CutToLength(text, maxLength-len(cutMarker))
	units, lastSpaceUnits, lastSpaceByte := 0, -1, -1
	for index, r := range kept {
		if r == ' ' {
			lastSpaceUnits, lastSpaceByte = units, index
		}
		units++
		if r >= 0x10000 {
			units++
		}
	}
	if lastSpaceUnits >= 0 && 2*lastSpaceUnits >= units {
		kept = kept[:lastSpaceByte]
	}
	return strings.TrimRightFunc(kept, unicode.IsSpace) + cutMarker
}
