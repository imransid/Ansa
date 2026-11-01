// Package assistant is core's side of the assistant: when it may answer,
// what it sends the brain, and the checks every proposed reply passes before
// it reaches a customer. The brain thinks; core decides what is sent.
package assistant

import (
	"ansa/core/internal/money"

	"regexp"
	"strings"
	"unicode"
)

// Why a proposed reply is stopped (then the holding reply goes out instead).
const (
	ReasonPriceNotOnMenu = "price_not_on_menu"
	ReasonRefundPromise  = "refund_promise"
	ReasonUnknownLink    = "unknown_link"
)

// CheckData is what a reply is checked against: the menu's prices (smallest
// units) and every text the business wrote that the AI read.
type CheckData struct {
	Currency   string
	MenuPrices []int64
	OwnerTexts []string
}

// The same marks, amounts and words as the old lib/assistant/reply-checks.ts.
const (
	symbols = "€$£¥₹৳₺₽₩₪₫฿₱₦₴₸₭"
	codes   = "EUR|USD|GBP|CHF|JPY|INR|BDT|TRY|RUB|KRW|ILS|VND|THB|PHP|NGN|UAH|KZT|SEK|NOK|DKK|PLN|BRL|CAD|AUD|NZD|MXN|AED|SAR|ZAR|CNY|HKD|SGD|MYR|IDR|PKR|EGP|CZK|HUF|RON"
	words   = "euros?|dollars?|pounds?|taka|rupees?|francs?|yen|lira|kr|zł|złoty"
	amount  = `\d{1,3}(?:[ .,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`
)

var (
	moneyBefore = regexp.MustCompile(`(?i)(?:[` + symbols + `]|R\$|\b(?:` + codes + `)\b)\s?(` + amount + `)`)
	moneyAfter  = regexp.MustCompile(`(?i)(` + amount + `)\s?(?:[` + symbols + `]|\b(?:` + codes + `|` + words + `)\b)`)
	refundWords = regexp.MustCompile(`(?i)\b(?:refund\w*|reimburs\w*|compensat\w*|money back|voucher\w*|rimbors\w*|risarci\w*|reembols\w*|indemniz\w*|rembours\w*|dédommag\w*|erstatt\w*|entschädig\w*|gutschein\w*)`)
	link        = regexp.MustCompile(`(?i)\bhttps?://[^\s<>"']+|\bwww\.[^\s<>"']+`)
)

// CheckReply returns "" when the reply may go, else the reason it may not.
func CheckReply(text string, data CheckData) string {
	if !pricesAreKnown(text, data) {
		return ReasonPriceNotOnMenu
	}
	if refundWords.MatchString(text) {
		return ReasonRefundPromise
	}
	if !linksAreKnown(text, data.OwnerTexts) {
		return ReasonUnknownLink
	}
	return ""
}

// MoneyAmounts lists the amounts written with a currency mark, in smallest
// units; -1 for one that can't be read as a price of this currency.
func MoneyAmounts(text, currency string) []int64 {
	var amounts []int64
	for _, pattern := range []*regexp.Regexp{moneyBefore, moneyAfter} {
		for _, match := range pattern.FindAllStringSubmatch(text, -1) {
			amounts = append(amounts, money.ParsePrice(dropThousandsSpaces(match[1]), currency))
		}
	}
	return amounts
}

func pricesAreKnown(text string, data CheckData) bool {
	allowed := map[int64]bool{}
	for _, price := range data.MenuPrices {
		allowed[price] = true
	}
	for _, owner := range data.OwnerTexts {
		for _, amount := range MoneyAmounts(owner, data.Currency) {
			if amount >= 0 {
				allowed[amount] = true
			}
		}
	}
	for _, amount := range MoneyAmounts(text, data.Currency) {
		if amount < 0 || !allowed[amount] {
			return false
		}
	}
	return true
}

func linksAreKnown(text string, ownerTexts []string) bool {
	written := strings.ToLower(strings.Join(ownerTexts, "\n"))
	for _, found := range link.FindAllString(text, -1) {
		cleaned := strings.ToLower(strings.TrimRight(found, ".,!?;:)]"))
		cleaned = strings.TrimPrefix(strings.TrimPrefix(cleaned, "https://"), "http://")
		if !strings.Contains(written, cleaned) {
			return false
		}
	}
	return true
}

// dropThousandsSpaces removes a space that sits before exactly three digits
// ("1 200" is 1200), as the old pattern / (?=\d{3}\b)/ does.
func dropThousandsSpaces(text string) string {
	runes := []rune(text)
	var out []rune
	for i, r := range runes {
		if r == ' ' && i+3 < len(runes)+1 && isThreeDigitsThenEnd(runes, i+1) {
			continue
		}
		out = append(out, r)
	}
	return string(out)
}

func isThreeDigitsThenEnd(runes []rune, start int) bool {
	if start+3 > len(runes) {
		return false
	}
	for _, r := range runes[start : start+3] {
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return start+3 == len(runes) || !unicode.IsDigit(runes[start+3]) && !unicode.IsLetter(runes[start+3]) && runes[start+3] != '_'
}

// AILabel is ansa's own first line in a conversation (never the AI's).
func AILabel(name, kind string) string {
	clean := strings.Join(strings.Fields(name), " ")
	if kind == "personal" {
		if clean == "" {
			return "I'm an AI assistant."
		}
		return "I'm " + clean + "'s AI assistant."
	}
	if clean == "" {
		clean = "this business"
	}
	return "I'm the AI assistant for " + clean + "."
}

// WithAILabel puts the label first on the first automated message.
func WithAILabel(text, name, kind string, first bool) string {
	if !first {
		return text
	}
	return AILabel(name, kind) + "\n" + text
}
