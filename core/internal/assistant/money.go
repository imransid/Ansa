package assistant

import (
	"strconv"
	"strings"
)

// The symbols English writes before an amount; other currencies get their code.
var currencySymbols = map[string]string{"EUR": "€", "USD": "$", "GBP": "£", "JPY": "¥", "INR": "₹", "KRW": "₩", "ILS": "₪", "VND": "₫", "NGN": "₦", "PHP": "₱", "TRY": "₺"}

// FormatMoney writes an amount in the currency's smallest units as a menu
// shows it: "€9.50", "¥1,200", "BDT 1,200.00".
func FormatMoney(cents int64, currency string) string {
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
