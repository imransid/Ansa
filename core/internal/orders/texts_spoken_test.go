package orders

import "testing"

// On a call an amount is said as a person says it: no currency code read
// out letter by letter, no ".00", Bengali digits and টাকা in Bangla.
func TestAmountsAreSaidAsPeopleSayThem(t *testing.T) {
	cases := []struct {
		cents              int64
		currency, language string
		want               string
	}{
		{70_000, "BDT", English, "700 taka"},
		{70_000, "BDT", Bangla, "৭০০ টাকা"},
		{104_050, "bdt", English, "1,040.50 taka"},
		{104_050, "BDT", Bangla, "১,০৪০.৫০ টাকা"},
		{100, "USD", English, "1 dollar"},
		{1_950, "EUR", English, "19.50 euros"},
		{1_200, "JPY", English, "1,200 yen"},
		{950, "CHF", English, "9.50 CHF"},
		{950, "CHF", Bangla, "৯.৫০ CHF"},
	}
	for _, c := range cases {
		if got := spokenPrice(c.cents, c.currency, c.language); got != c.want {
			t.Errorf("%d %s %s: got %q, want %q", c.cents, c.currency, c.language, got, c.want)
		}
	}
}
