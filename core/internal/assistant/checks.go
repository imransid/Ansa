// Package assistant is core's side of the assistant: when it may answer,
// what it sends the brain, and the checks every proposed reply passes before
// it reaches a customer. The brain thinks; core decides what is sent.
package assistant

import (
	"ansa/core/internal/money"
	"ansa/core/internal/orders"

	"regexp"
	"strings"
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
	// One person's account: a reply may not commit them (commitments.go).
	Personal bool
}

// The same marks, amounts and words as the old lib/assistant/reply-checks.ts,
// and taka as Bangladesh writes it: "Tk 450", "Tk. 450", "450 Tk" and
// "৪৫০ টাকা". টাকা goes without \b, which knows only ASCII letters, and
// keeps its endings ("৩০০ টাকায়": for 300 taka). An amount may be grouped
// the South Asian way ("1,50,000", tried first: in groups of three it would
// be read as "1,50") or in thousands ("15,000", "1 200", "1.040,50").
const (
	symbols = "€$£¥₹৳₺₽₩₪₫฿₱₦₴₸₭"
	codes   = "EUR|USD|GBP|CHF|JPY|INR|BDT|TRY|RUB|KRW|ILS|VND|THB|PHP|NGN|UAH|KZT|SEK|NOK|DKK|PLN|BRL|CAD|AUD|NZD|MXN|AED|SAR|ZAR|CNY|HKD|SGD|MYR|IDR|PKR|EGP|CZK|HUF|RON"
	words   = "euros?|dollars?|pounds?|taka|rupees?|francs?|yen|lira|kr|zł|złoty"
	amount  = `\d{1,2}(?:[ .,]\d{2})+[ .,]\d{3}(?:[.,]\d{1,2})?|\d{1,3}(?:[ .,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`
)

var (
	moneyBefore = regexp.MustCompile(`(?i)(?:[` + symbols + `]|R\$|\b(?:` + codes + `)\b|\bTk\b\.?)\s?(` + amount + `)`)
	moneyAfter  = regexp.MustCompile(`(?i)(` + amount + `)\s?(?:[` + symbols + `]|\b(?:` + codes + `|` + words + `|Tk)\b|টাকা)`)
	refundWords = regexp.MustCompile(`(?i)\b(?:refund\w*|reimburs\w*|compensat\w*|money back|voucher\w*|rimbors\w*|risarci\w*|reembols\w*|indemniz\w*|rembours\w*|dédommag\w*|erstatt\w*|entschädig\w*|gutschein\w*)`)
	// Bangla's refund, money back, compensation and voucher. \b and \w know
	// only ASCII letters, so a word starts after anything but a letter or a
	// mark, and keeps its endings ("রিফান্ডের"). Never a bare ফেরত ("back"):
	// ফেরত কল is a call back, a normal reply.
	refundWordsBangla = regexp.MustCompile(`(?:^|[^\p{L}\p{M}])(?:রিফান্ড|টাকা ফেরত|ক্ষতিপূরণ|ভাউচার)`)
	link              = regexp.MustCompile(`(?i)\bhttps?://[^\s<>"']+|\bwww\.[^\s<>"']+`)
)

// CheckReply returns "" when the reply may go, else the reason it may not.
func CheckReply(text string, data CheckData) string {
	if _, unknown := firstUnknownAmount(text, data); unknown {
		return ReasonPriceNotOnMenu
	}
	if refundWords.MatchString(text) || refundWordsBangla.MatchString(text) {
		return ReasonRefundPromise
	}
	if !linksAreKnown(text, data.OwnerTexts) {
		return ReasonUnknownLink
	}
	if data.Personal && !commitmentsAreKnown(text, data.OwnerTexts) {
		return ReasonNeedsDecision
	}
	return ""
}

// MoneyAmounts lists the amounts written with a currency mark, in smallest
// units; -1 for one that can't be read as a price of this currency. Each is
// read as the menu's own prices are (money.ParsePrice: "15,000" is fifteen
// thousand, "1,50,000" a hundred and fifty thousand), so a price the owner
// wrote reads the same in a reply.
func MoneyAmounts(text, currency string) []int64 {
	var amounts []int64
	for _, mention := range moneyMentions(text, currency) {
		amounts = append(amounts, mention.amount)
	}
	return amounts
}

// moneyMention is one amount written with a currency mark: as written (any
// script's digits as 0-9) and in smallest units (-1: unreadable).
type moneyMention struct {
	written string
	amount  int64
}

func moneyMentions(text, currency string) []moneyMention {
	text = money.WithASCIIDigits(text)
	var mentions []moneyMention
	for _, pattern := range []*regexp.Regexp{moneyBefore, moneyAfter} {
		for _, match := range pattern.FindAllStringSubmatch(text, -1) {
			mentions = append(mentions, moneyMention{written: strings.TrimSpace(match[0]), amount: money.ParsePrice(match[1], currency)})
		}
	}
	return mentions
}

// firstUnknownAmount is the first amount of the reply, as written, that is
// neither a menu price nor in the business's own texts (or can't be read as
// a price), and whether there is one.
func firstUnknownAmount(text string, data CheckData) (string, bool) {
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
	for _, mention := range moneyMentions(text, data.Currency) {
		if mention.amount < 0 || !allowed[mention.amount] {
			return mention.written, true
		}
	}
	return "", false
}

// StoppedAmount is the amount that stopped a reply (price_not_on_menu) as
// the reply wrote it ("250 taka"), at most 40 characters; "" when there is none.
func StoppedAmount(text string, data CheckData) string {
	written, _ := firstUnknownAmount(text, data)
	return cutRunes(strings.Join(strings.Fields(written), " "), 40)
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

// AILabel is ansa's own first line in a conversation (never the AI's), in English.
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

// AILabelIn is the label in the customer's language, chosen as ansa's
// order texts choose theirs (orders.LanguageOf on the customer's newest
// message): Bangla for a customer writing mostly in Bengali script, else
// English. The name stays as written.
func AILabelIn(name, kind, language string) string {
	if language != orders.Bangla {
		return AILabel(name, kind)
	}
	clean := strings.Join(strings.Fields(name), " ")
	switch {
	case clean != "":
		return "আমি " + clean + "-এর এআই সহকারী।"
	case kind == "personal":
		return "আমি একজন এআই সহকারী।"
	}
	return "আমি এই ব্যবসার এআই সহকারী।"
}

// WithAILabel puts the label first on the first automated message, in the
// customer's language.
func WithAILabel(text, name, kind, language string, first bool) string {
	if !first {
		return text
	}
	return AILabelIn(name, kind, language) + "\n" + text
}
