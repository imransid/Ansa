package money

import (
	"encoding/json"
	"os"
	"testing"
)

// The cases the screens' copy (lib/menu.ts parsePrice) reads too: thousands
// grouped ("1,200", "1.200,50"), the South Asian way ("1,50,000"), any
// script's digits ("৪৫০"), and the currency's own decimals ("1.250" KWD).
func TestPricesAreReadInTheCurrencysUnits(t *testing.T) {
	data, err := os.ReadFile("testdata/prices.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors struct {
		Cases []struct {
			Text, Currency string
			Cents          *int64
		}
	}
	if err := json.Unmarshal(data, &vectors); err != nil || len(vectors.Cases) == 0 {
		t.Fatalf("the vectors: %v", err)
	}
	for _, c := range vectors.Cases {
		want := int64(-1)
		if c.Cents != nil {
			want = *c.Cents
		}
		if got := ParsePrice(c.Text, c.Currency); got != want {
			t.Errorf("%q %s: got %d, want %d", c.Text, c.Currency, got, want)
		}
	}
}

func TestEveryScriptsDigitsAreWrittenAs0To9(t *testing.T) {
	if got := WithASCIIDigits("৳৩০০, ₹३००, €٣ or $４５"); got != "৳300, ₹300, €3 or $45" {
		t.Errorf("got %q", got)
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

// Spoken, an amount keeps its decimals only when there are some.
func TestAnAmountIsSaidWithDecimalsOnlyWhenItHasSome(t *testing.T) {
	cases := map[string]string{SpokenNumber(70000, "BDT"): "700", SpokenNumber(104050, "BDT"): "1,040.50", SpokenNumber(5, "USD"): "0.05",
		SpokenNumber(120000, "JPY"): "120,000", SpokenNumber(1250, "KWD"): "1.250", SpokenNumber(1000, "KWD"): "1"}
	for got, want := range cases {
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	}
}
