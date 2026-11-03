package orders

import (
	"strings"

	"ansa/core/internal/money"
)

// How ansa says an amount on a call: as a person says it ("700 taka", "9.50
// euros": decimals only when there are some), never a currency code a voice
// reads letter by letter ("BDT 700.00"); in Bangla with Bengali digits and
// the currency's Bangla word ("৭০০ টাকা"). A currency without words here
// keeps its code.

// currencyWords: the English word for one and for more, and the Bangla word.
type currencyWords struct{ one, many, bangla string }

var spokenCurrencies = map[string]currencyWords{
	"BDT": {"taka", "taka", "টাকা"},
	"INR": {"rupee", "rupees", "রুপি"},
	"PKR": {"rupee", "rupees", "রুপি"},
	"NPR": {"rupee", "rupees", "রুপি"},
	"LKR": {"rupee", "rupees", "রুপি"},
	"USD": {"dollar", "dollars", "ডলার"},
	"CAD": {"dollar", "dollars", "ডলার"},
	"AUD": {"dollar", "dollars", "ডলার"},
	"EUR": {"euro", "euros", "ইউরো"},
	"GBP": {"pound", "pounds", "পাউন্ড"},
	"JPY": {"yen", "yen", "ইয়েন"},
	"AED": {"dirham", "dirhams", "দিরহাম"},
	"SAR": {"riyal", "riyals", "রিয়াল"},
}

// spokenPrice is an amount as ansa says it on a call, in the language.
func spokenPrice(cents int64, currency, language string) string {
	number := money.SpokenNumber(cents, currency)
	words, known := spokenCurrencies[strings.ToUpper(currency)]
	name := strings.ToUpper(currency)
	switch {
	case language == Bangla:
		if known {
			name = words.bangla
		}
		return bengaliDigits(number) + " " + name
	case !known:
		return number + " " + name
	case number == "1":
		return number + " " + words.one
	}
	return number + " " + words.many
}

// bengaliDigits writes 0-9 as Bengali digits (০-৯), the rest as it is.
func bengaliDigits(text string) string {
	return strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return '০' + (r - '0')
		}
		return r
	}, text)
}
