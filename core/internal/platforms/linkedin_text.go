package platforms

import (
	"regexp"
	"strings"

	"ansa/core/internal/contentrules"
)

// LinkedIn's Posts API reads a post's text ("commentary") in its "little"
// text format, where these characters start mentions, hashtags and
// templates. LinkedIn says to escape every one with a backslash, used or
// not, or the post can lose text (an unescaped "(" can cut it short). A
// hashtag becomes its hashtag template, as LinkedIn itself writes them back
// ("{hashtag|\#|bread}"), so it still links. From learn.microsoft.com's
// "little Text Format" (read 2026-10-28; the old lib/linkedin-text.ts).
// NOT TESTED against LinkedIn.

var littleTextReserved = regexp.MustCompile(`[\\|{}@\[\]()<>#*_~]`)

// "#" at the start or after a space (JavaScript's \s: Unicode spaces too),
// then the word a hashtag can be (the content rules decide which can).
var littleTextHashtag = regexp.MustCompile(`(^|[\t\n\v\f\r\p{Z}\x{FEFF}])#([\p{L}\p{M}\p{N}_]+)`)

// LinkedInLittleText is the text as LinkedIn's commentary field must hold it.
func LinkedInLittleText(text string) string {
	var converted strings.Builder
	copiedUpTo := 0
	for _, match := range littleTextHashtag.FindAllStringSubmatchIndex(text, -1) {
		hashSign, tagStart, tagEnd := match[3], match[4], match[5]
		tag := text[tagStart:tagEnd]
		if !contentrules.IsValidHashtag(tag) {
			continue
		}
		converted.WriteString(escapeLittleText(text[copiedUpTo:hashSign]))
		converted.WriteString(`{hashtag|\#|` + escapeLittleText(tag) + "}")
		copiedUpTo = tagEnd
	}
	converted.WriteString(escapeLittleText(text[copiedUpTo:]))
	return converted.String()
}

func escapeLittleText(text string) string {
	return littleTextReserved.ReplaceAllStringFunc(text, func(character string) string { return `\` + character })
}
