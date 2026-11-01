package money

import "testing"

func TestPricesAreReadInTheCurrencysUnits(t *testing.T) {
	cases := []struct {
		text, currency string
		want           int64
	}{
		{"9.50", "EUR", 950}, {"9,5", "EUR", 950}, {"€ 12", "EUR", 1200}, {"1200", "JPY", 1200},
		{"9.5", "JPY", -1}, {"-5", "EUR", -1}, {"1.250", "KWD", 1250}, {"9.999", "EUR", -1},
	}
	for _, c := range cases {
		if got := ParsePrice(c.text, c.currency); got != c.want {
			t.Errorf("%q %s: got %d, want %d", c.text, c.currency, got, c.want)
		}
	}
}

func TestMoneyIsWrittenAsTheMenuShowsIt(t *testing.T) {
	cases := map[string]string{Format(950, "EUR"): "€9.50", Format(120000, "JPY"): "¥120,000", Format(120000, "BDT"): "BDT 1,200.00", Format(5, "USD"): "$0.05"}
	for got, want := range cases {
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	}
}
