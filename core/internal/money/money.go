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

// ParsePrice reads a price as people write it ("9.50", "9,50", "1 200") in
// the currency's smallest units, or -1 (as the old lib/menu.ts parsePrice).
func ParsePrice(text, currency string) int64 {
	if strings.ContainsAny(text, "-−") {
		return -1
	}
	digits := MinorUnitDigits(currency)
	var kept strings.Builder
	for _, r := range text {
		if unicode.IsDigit(r) && r < 128 || r == '.' || r == ',' {
			kept.WriteRune(r)
		}
	}
	number := strings.TrimRight(kept.String(), ".,")
	whole, fraction, hasFraction := strings.Cut(strings.ReplaceAll(number, ",", "."), ".")
	if strings.Contains(fraction, ".") || len(whole) == 0 || len(whole) > 9 || (hasFraction && (len(fraction) == 0 || len(fraction) > digits)) {
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
	if hasFraction {
		padded := fraction + strings.Repeat("0", digits-len(fraction))
		fractionValue, _ = strconv.ParseInt(padded, 10, 64)
	}
	cents := wholeValue*scale + fractionValue
	if cents > 100_000_000 {
		return -1
	}
	return cents
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
