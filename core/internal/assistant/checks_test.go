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

// Lakhs are grouped the South Asian way, two digits before the last three:
// "1,50,000" is one amount of 150,000, not 1.50 (money.ParsePrice's rule).
func TestAmountsGroupedTheSouthAsianWayAreOneAmount(t *testing.T) {
	amounts := MoneyAmounts("Tk 1,50,000 for a wedding, 1,50,000 taka or ১,৫০,০০০ টাকা; a sign ৳12,34,567", "BDT")
	if fmt.Sprint(amounts) != "[15000000 -1 15000000 15000000]" {
		t.Fatalf("amounts: %v", amounts)
	}
	catering := CheckData{Currency: "BDT", OwnerTexts: []string{"বিয়ের ক্যাটারিং ১,৫০,০০০ টাকা থেকে।"}}
	if got := CheckReply("Wedding catering starts at Tk 1,50,000.", catering); got != "" {
		t.Fatalf("the owner's own amount: %q", got)
	}
	if got := CheckReply("Wedding catering starts at Tk 1,40,000.", catering); got != ReasonPriceNotOnMenu {
		t.Fatalf("an amount the owner never wrote: %q", got)
	}
}

// Prices in Bengali digits, or written with Tk or টাকা, are amounts too:
// they passed unread, as RE2's \d is 0-9 only.
func TestBengaliDigitsTkAndTakaAreReadAsPrices(t *testing.T) {
	kacchi := CheckData{Currency: "BDT", MenuPrices: []int64{45000, 8000}}
	cases := map[string]string{
		"কাচ্চি বিরিয়ানি ৳300":          ReasonPriceNotOnMenu,
		"কাচ্চি বিরিয়ানি ৳৩০০":          ReasonPriceNotOnMenu,
		"কাচ্চি বিরিয়ানির দাম ৩০০ টাকা": ReasonPriceNotOnMenu,
		"কাচ্চি বিরিয়ানি ৩০০টাকায়":     ReasonPriceNotOnMenu,
		"Kacchi is 300 Tk":  ReasonPriceNotOnMenu,
		"Kacchi is Tk 300":  ReasonPriceNotOnMenu,
		"Kacchi is Tk. 300": ReasonPriceNotOnMenu,
		"কাচ্চি বিরিয়ানি ৪৫০ টাকা":         "",
		"কাচ্চি বিরিয়ানি ৳৪৫০":             "",
		"Kacchi is Tk 450, a lassi ৮০ টাকা": "",
		"রাত ১০টা পর্যন্ত খোলা":             "",
	}
	for text, want := range cases {
		if got := CheckReply(text, kacchi); got != want {
			t.Errorf("%q: got %q, want %q", text, got, want)
		}
	}
	// Every script's digits, thousands included (step 58's rule).
	if amounts := MoneyAmounts("লোগো ১৫,০০০ টাকা থেকে; ₹३००, €٣ or $４５", "BDT"); fmt.Sprint(amounts) != "[30000 300 4500 1500000]" {
		t.Errorf("amounts: %v", amounts)
	}
	// The owner's own amounts are read the same way.
	delivery := CheckData{Currency: "BDT", OwnerTexts: []string{"ঢাকার ভেতরে ডেলিভারি চার্জ ৳৬০।"}}
	if got := CheckReply("Delivery inside Dhaka is ৳60.", delivery); got != "" {
		t.Errorf("an amount the owner wrote in Bengali digits: %q", got)
	}
}

// Refund words in Bangla stop a reply too; a bare ফেরত ("back") doesn't:
// ফেরত কল is a call back, a normal reply.
func TestBanglaRefundWordsStopAReply(t *testing.T) {
	cases := map[string]string{
		"আপনার টাকা ফেরত দেওয়া হবে":          ReasonRefundPromise,
		"আমরা রিফান্ড করে দেব":                ReasonRefundPromise,
		"রিফান্ডের জন্য একটু অপেক্ষা করুন":    ReasonRefundPromise,
		"ক্ষতিপূরণ হিসেবে একটি ডেজার্ট পাবেন": ReasonRefundPromise,
		"পরের অর্ডারে একটি ভাউচার পাবেন":      ReasonRefundPromise,
		"ম্যানেজার আপনাকে ফেরত কল করবেন":      "",
	}
	for text, want := range cases {
		if got := CheckReply(text, data); got != want {
			t.Errorf("%q: got %q, want %q", text, got, want)
		}
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
