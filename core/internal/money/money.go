// Package money reads and writes amounts in a currency's smallest units
// (cents for EUR, yen for JPY), as the old lib/menu.ts does: prices are
// stored as whole numbers, never as floating point.
package money

import (
	"strconv"
	"strings"
	"unicode"
)

// The symbols English writes before an amount; other currencies get their code.
var currencySymbols = map[string]string{"EUR": "€", "USD": "$", "GBP": "£", "JPY": "¥", "INR": "₹", "KRW": "₩", "ILS": "₪", "VND": "₫", "NGN": "₦", "PHP": "₱", "TRY": "₺"}

// Format writes an amount in the currency's smallest units as a menu
// shows it: "€9.50", "¥1,200", "BDT 1,200.00".
func Format(cents int64, currency string) string {
	digits := MinorUnitDigits(currency)
	scale := int64(1)
	for i := 0; i < digits; i++ {
		scale *= 10
	}
	whole := strconv.FormatInt(cents/scale, 10)
	var grouped strings.Builder
	for i, r := range whole {
		if i > 0 && (len(whole)-i)%3 == 0 {
			grouped.WriteByte(',')
		}
		grouped.WriteRune(r)
	}
	number := grouped.String()
	if digits > 0 {
		fraction := strconv.FormatInt(cents%scale, 10)
		number += "." + strings.Repeat("0", digits-len(fraction)) + fraction
	}
	if symbol, ok := currencySymbols[strings.ToUpper(currency)]; ok {
		return symbol + number
	}
	return strings.ToUpper(currency) + " " + number
}

// ParsePrice reads a price as people write it in the currency's smallest
// units, or -1. Only digits, "." and "," count ("€ 12", "1 200", "৪৫০ টাকা":
// any script's digits). One mark before at most the currency's decimals is
// the point ("9,50"); one before exactly three digits groups thousands
// ("1,200"), unless the currency has three decimals (KWD's "1.250"); with
// both marks the last is the point ("1.200,50", "1,200.50"); a mark used
// twice groups ("1,200,000", or the South Asian way "1,50,000"). The
// screens' copy (lib/menu.ts parsePrice) reads testdata/prices.json too.
func ParsePrice(text, currency string) int64 {
	if strings.ContainsAny(text, "-−") {
		return -1
	}
	digits := MinorUnitDigits(currency)
	var kept strings.Builder
	for _, r := range WithASCIIDigits(text) {
		if r >= '0' && r <= '9' || r == '.' || r == ',' {
			kept.WriteRune(r)
		}
	}
	whole, fraction, ok := splitPrice(strings.TrimRight(kept.String(), ".,"), digits)
	if !ok || len(whole) == 0 || len(whole) > 9 || len(fraction) > digits {
		return -1
	}
	wholeValue, err := strconv.ParseInt(whole, 10, 64)
	if err != nil {
		return -1
	}
	scale := int64(1)
	for i := 0; i < digits; i++ {
		scale *= 10
	}
	fractionValue := int64(0)
	if fraction != "" {
		fractionValue, _ = strconv.ParseInt(fraction+strings.Repeat("0", digits-len(fraction)), 10, 64)
	}
	cents := wholeValue*scale + fractionValue
	if cents > 100_000_000 {
		return -1
	}
	return cents
}

// splitPrice splits digits and marks into the whole number (its grouping
// left out) and the decimals; false when the marks make no price.
func splitPrice(number string, digits int) (whole, fraction string, ok bool) {
	last := strings.LastIndexAny(number, ".,")
	if last < 0 {
		return number, "", true
	}
	mark, other := number[last:last+1], ","
	if mark == "," {
		other = "."
	}
	before, after := number[:last], number[last+1:]
	switch {
	case strings.Contains(before, mark):
		// One mark used twice groups, and there are no decimals.
		whole, ok = grouped(number, mark)
		return whole, "", ok
	case strings.Contains(before, other):
		// Both marks: the last one is the point.
		whole, ok = grouped(before, other)
		return whole, after, ok
	case len(after) == 3 && digits < 3 && isLeadingGroup(before, 3):
		// "1,200": three digits can't be this currency's decimals.
		return before + after, "", true
	}
	return before, after, true
}

// grouped reads a whole number written in groups: of three ("1,200,000")
// or, the South Asian way, of two before the last three ("1,50,000",
// "12,34,567"). False when it is no such number.
func grouped(number, mark string) (string, bool) {
	groups := strings.Split(number, mark)
	size := 3
	if len(groups) > 2 && len(groups[1]) == 2 {
		size = 2
	}
	if len(groups) < 2 || !isLeadingGroup(groups[0], size) || len(groups[len(groups)-1]) != 3 {
		return "", false
	}
	for _, group := range groups[1 : len(groups)-1] {
		if len(group) != size {
			return "", false
		}
	}
	joined := strings.Join(groups, "")
	return joined, strings.Trim(joined, "0123456789") == ""
}

// isLeadingGroup: the first group of a grouped number, 1 to `size` digits
// and no leading zero ("0,500" groups nothing: it is no five hundred).
func isLeadingGroup(group string, size int) bool {
	return len(group) >= 1 && len(group) <= size && group[0] != '0'
}

// WithASCIIDigits writes every script's decimal digits as 0-9 ("৳৩০০" is
// "৳300"): RE2's \d is 0-9 only, so a price written in Bengali digits passed
// the assistant's checks unread, and one typed in the menu was refused. Unicode
// keeps each script's digits in a row from 0 to 9, so a digit's value is how
// far it sits from its row's zero (modulo 10: some rows follow each other,
// like the five of mathematical digits).
func WithASCIIDigits(text string) string {
	return strings.Map(func(r rune) rune {
		if !unicode.IsDigit(r) {
			return r
		}
		zero := r
		for unicode.IsDigit(zero - 1) {
			zero--
		}
		return '0' + (r-zero)%10
	}, text)
}

// MinorUnitDigits is how many digits a currency's prices have after the
// point (ISO 4217): 0 for yen or won, 3 for dinars, 2 for most.
func MinorUnitDigits(currency string) int {
	switch strings.ToUpper(currency) {
	case "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF":
		return 0
	case "BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND":
		return 3
	default:
		return 2
	}
}
