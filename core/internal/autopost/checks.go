package autopost

import (
	"regexp"
	"strings"

	"ansa/core/internal/assistant"
	"ansa/core/internal/contentrules"
	"ansa/core/internal/money"
)

// Post is the text the brain wrote.
type Post struct {
	Body, CallToAction string
	Hashtags           []string
}

// CheckData is what ansa checks a post against.
type CheckData struct {
	assistant.CheckData
	WordsToAvoid []string
}

var percentage = regexp.MustCompile(`\d+(?:[.,]\d+)?\s?%`)

var offerWords = regexp.MustCompile(`(?i)\b(discount|discounts|promo|promotion|coupon|voucher|sconto|descuento|remise|rabatt)\b`)

// CheckText says whether a post may go out (the old lib/autopost/checks.ts),
// on the whole published text: the assistant's reply checks (every amount
// with a currency mark a listed price or in the owner's own words, no
// refund or compensation words, every link the owner's own); every
// percentage and every discount, promo or coupon word the owner's own (an
// offer the AI made up is the worst post); and Facebook's own rules (length,
// hashtags, the owner's words to avoid).
func CheckText(post Post, data CheckData) bool {
	published := contentrules.Post{Body: post.Body, CallToAction: post.CallToAction, Hashtags: post.Hashtags}
	text := contentrules.PublishedText(published)
	if assistant.CheckReply(text, data.CheckData) != "" {
		return false
	}
	// Any script's digits are read as 0-9 ("৫০%" is "50%"), the owner's
	// too: RE2's \d is 0-9 only, so a made-up offer in Bengali digits passed.
	owners := strings.ToLower(money.WithASCIIDigits(strings.Join(data.OwnerTexts, "\n")))
	for _, found := range percentage.FindAllString(money.WithASCIIDigits(text), -1) {
		if !strings.Contains(owners, strings.ReplaceAll(found, " ", "")) && !strings.Contains(owners, found) {
			return false
		}
	}
	for _, word := range offerWords.FindAllString(strings.ToLower(text), -1) {
		if !strings.Contains(owners, word) {
			return false
		}
	}
	return len(contentrules.FacebookProblems(published, data.WordsToAvoid)) == 0
}
