package assistant

import "testing"

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
