package assistant

import (
	"fmt"
	"testing"
)

var data = CheckData{Currency: "EUR", MenuPrices: []int64{950, 600}, OwnerTexts: []string{"Delivery costs €2.50 within 3 km.", "Our website is https://luigis.example/menu."}}

func TestARepliedPriceMustBeOnTheMenuOrInTheOwnersWords(t *testing.T) {
	cases := map[string]string{
		"Our Margherita is €9.50.":                "",
		"Margherita: 9,50 €, tiramisù 6 euros.":   "",
		"Delivery is EUR 2.50.":                   "",
		"The Margherita is €8.":                   ReasonPriceNotOnMenu,
		"That's 12 dollars.":                      ReasonPriceNotOnMenu,
		"No price here, see you at 9.":            "",
		"We can refund you.":                      ReasonRefundPromise,
		"Ti rimborsiamo subito.":                  ReasonRefundPromise,
		"See https://luigis.example/menu.":        "",
		"Book at https://other.example/book now.": ReasonUnknownLink,
		"Visit www.luigis.example/menu!":          ReasonUnknownLink, // written without www by the owner: the old check stops it too
	}
	for text, want := range cases {
		if got := CheckReply(text, data); got != want {
			t.Errorf("%q: got %q, want %q", text, got, want)
		}
	}
}

func TestThousandsWrittenWithASpaceAreOneAmount(t *testing.T) {
	if amounts := MoneyAmounts("A party for €1 200 or 1 200 €", "EUR"); len(amounts) != 2 || amounts[0] != 120000 || amounts[1] != 120000 {
		t.Errorf("thousands with a space: %v", amounts)
	}
}

// Thousands written with a comma or a dot are one amount too, so a price
// over a thousand in the owner's words lets the AI repeat it (step 58).
func TestThousandsWrittenWithACommaOrADotAreOneAmount(t *testing.T) {
	// Marks before the number are read first ("৳1,040.50", "€9.50"), then after.
	amounts := MoneyAmounts("A logo is 15,000 taka, a menu ৳1,040.50, a sign 1.040,50 € and lunch €9.50", "BDT")
	if fmt.Sprint(amounts) != "[104050 950 1500000 104050]" {
		t.Fatalf("amounts: %v", amounts)
	}
	person := CheckData{Currency: "BDT", OwnerTexts: []string{"A logo starts at 15,000 taka and takes about a week."}}
	if got := CheckReply("Rafa's logos start at 15,000 taka (৳15,000).", person); got != "" {
		t.Fatalf("the owner's own amount: %q", got)
	}
	if got := CheckReply("A logo is ৳12,000.", person); got != ReasonPriceNotOnMenu {
		t.Fatalf("an amount the owner never wrote: %q", got)
	}
}

func TestTheAILabelSaysWhoItWorksFor(t *testing.T) {
	if got := WithAILabel("Hi!", "Luigi's", "business", true); got != "I'm the AI assistant for Luigi's.\nHi!" {
		t.Errorf("business: %q", got)
	}
	if got := AILabel("Rafa", "personal"); got != "I'm Rafa's AI assistant." {
		t.Errorf("personal: %q", got)
	}
	if got := WithAILabel("Hi!", "Luigi's", "business", false); got != "Hi!" {
		t.Errorf("only the first message: %q", got)
	}
}
