package orders

import "testing"

// A customer whose newest message is mostly in Bengali script gets ansa's
// order texts in Bangla; anyone else in English.
func TestTheCustomersNewestMessagePicksTheLanguage(t *testing.T) {
	cases := map[string]string{
		"দুটো কাচ্চি বিরিয়ানি চাই, নিজে এসে নেব": Bangla,
		"হ্যাঁ":                     Bangla,
		"২টা Kacchi দিন ভাই":        Bangla,
		"Two kacchi biryani please": English,
		"Kacchi 2ta den":            English,
		"৪৫০":                       English,
		"":                          English,
	}
	for text, want := range cases {
		if got := LanguageOf(text); got != want {
			t.Errorf("%q: got %q, want %q", text, got, want)
		}
	}
}

// The Bangla texts: ansa's own words, numbers and prices written as in
// English (money.Format), the dish names as the menu has them.
func TestAnsasOrderTextsInBangla(t *testing.T) {
	order, _ := Price(Request{Items: []Item{{"M1", 2}}, Fulfilment: "delivery", Address: "Road 27, Dhanmondi", Notes: "কম ঝাল"}, menu, both)
	want := "আপনার অর্ডার:\n2 × Margherita: €19.00\nডেলিভারি চার্জ: €2.50\nমোট: €21.50\nডেলিভারির ঠিকানা: Road 27, Dhanmondi\nকখন: যত তাড়াতাড়ি সম্ভব\nনোট: কম ঝাল\n\nঅর্ডারটি কি নিশ্চিত করব? নিশ্চিত করতে “হ্যাঁ” লিখে পাঠান।"
	if got := SummaryText(order, Bangla); got != want {
		t.Fatalf("summary:\n%s", got)
	}
	spoken := "আপনার অর্ডার: ২ Margherita, ১৯ ইউরো। ডেলিভারি চার্জ, ২.৫০ ইউরো। মোট, ২১.৫০ ইউরো। ডেলিভারির ঠিকানা: Road 27, Dhanmondi। কখন: যত তাড়াতাড়ি সম্ভব। নোট: কম ঝাল। অর্ডারটি কি নিশ্চিত করব? নিশ্চিত করতে অনুগ্রহ করে হ্যাঁ বলুন।"
	if got := SpokenSummaryText(order, Bangla); got != spoken {
		t.Fatalf("spoken summary:\n%s", got)
	}
	texts := map[string]string{
		Question(GapNoItems, both, Bangla):                "আপনি কী অর্ডার করতে চান?",
		Question(GapAddress, both, Bangla):                "কোথায় ডেলিভারি দেব? অনুগ্রহ করে পুরো ঠিকানাটা পাঠান।",
		SpokenQuestion(GapAddress, both, Bangla):          "কোথায় ডেলিভারি দেব? অনুগ্রহ করে পুরো ঠিকানাটা বলুন।",
		Question(GapHow, both, Bangla):                    "আপনি কি ডেলিভারি নেবেন, নাকি নিজে এসে নিয়ে যাবেন?",
		Question(GapHow, Options{Delivery: true}, Bangla): "আমরা ডেলিভারি দিই: কোথায় পৌঁছে দেব? অনুগ্রহ করে পুরো ঠিকানাটা পাঠান।",
		Question(GapHow, Options{Pickup: true}, Bangla):   "আমরা ডেলিভারি দিই না, তবে আপনি নিজে এসে নিয়ে যেতে পারেন। নিজে এসে নিলে চলবে?",
		Question(GapHow, Options{}, Bangla):               "দুঃখিত, এই মুহূর্তে আমরা অর্ডার নিতে পারছি না।",
		PlacedText(12, Bangla):                            "ধন্যবাদ! আপনার অর্ডার #12 দেওয়া হয়েছে। অর্ডারটি গ্রহণ করা হলেই আমরা আপনাকে মেসেজ করে জানাব।",
		SpokenPlacedText(12, Bangla):                      "ধন্যবাদ! আপনার অর্ডার নম্বর 12 দেওয়া হয়েছে।",
		WithdrawnText(Bangla):                             "কোনো সমস্যা নেই: কোনো অর্ডার দেওয়া হয়নি।",
		ClosedText("Opens at 18:00", Bangla):              "দুঃখিত, এই মুহূর্তে আমরা অর্ডার নিতে পারছি না (18:00-এ খুলবে)।",
		ClosedText("Closed today", Bangla):                "দুঃখিত, এই মুহূর্তে আমরা অর্ডার নিতে পারছি না (আজ বন্ধ)।",
		StatusText("accept", 7, "pickup", false, Bangla):  "আপনার অর্ডার #7 গ্রহণ করা হয়েছে। আমরা অর্ডারটি প্রস্তুত করছি।",
		StatusText("ready", 7, "delivery", false, Bangla): "আপনার অর্ডার #7 পথে আছে।",
		StatusText("ready", 7, "pickup", false, Bangla):   "আপনার অর্ডার #7 তৈরি, এসে নিয়ে যেতে পারেন।",
		StatusText("done", 7, "pickup", false, Bangla):    "অর্ডার #7-এর জন্য ধন্যবাদ!",
		StatusText("cancel", 7, "pickup", true, Bangla):   "দুঃখিত, আমরা আপনার অর্ডার #7 নিতে পারছি না। কোনো প্রশ্ন থাকলে এখানে আমাদের লিখুন।",
		StatusText("cancel", 7, "pickup", false, Bangla):  "দুঃখিত, আপনার অর্ডার #7 বাতিল করা হয়েছে। কোনো প্রশ্ন থাকলে এখানে আমাদের লিখুন।",
	}
	for got, want := range texts {
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	}
}

// The plan speaks the customer's language: a Bangla customer's summary, the
// closed-now answer and the "no" are Bangla; English stays as it is.
func TestThePlanSpeaksTheCustomersLanguage(t *testing.T) {
	request := &Request{Items: []Item{{"M1", 1}}, Fulfilment: "pickup"}
	bangla := Ordering{TakesOrders: true, Menu: menu, Options: both, Language: Bangla}
	if step := PlanStep("order_summary", request, bangla, "business"); step.Kind != StepPropose || step.Text != SummaryText(step.Order, Bangla) {
		t.Fatalf("a Bangla summary: %+v", step)
	}
	if step := PlanStep("order_withdrawn", nil, bangla, "business"); step.Text != WithdrawnText(Bangla) {
		t.Fatalf("a Bangla no: %+v", step)
	}
	bangla.ClosedNow = "Opens at 18:00"
	if step := PlanStep("order_summary", request, bangla, "business"); step.Text != ClosedText("Opens at 18:00", Bangla) {
		t.Fatalf("closed, in Bangla: %+v", step)
	}
	if step := PlanStep("order_withdrawn", nil, Ordering{TakesOrders: true, Menu: menu, Options: both}, "business"); step.Text != "No problem: nothing was ordered." {
		t.Fatalf("English as it is: %+v", step)
	}
}
