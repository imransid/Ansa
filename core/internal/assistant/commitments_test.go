package assistant

import "testing"

// Rafa's own texts: what he does, his instructions and a saved answer.
var rafa = CheckData{Currency: "BDT", Personal: true, OwnerTexts: []string{
	"Logo and brand designer.",
	"A logo starts at 15,000 taka and takes about a week.",
	"I take calls on Mondays from 10:00 to 12:00.",
}}

// For one person a reply never commits them: a clock time, a day or an
// agreement they never wrote themselves stops it (a note for them, and
// their holding reply instead), in English and in Bangla. One they wrote
// may be repeated, in either language and either way of writing a time.
func TestAPersonsReplyNeverCommitsThem(t *testing.T) {
	passes := []string{
		"Rafa will get back to you soon.",
		"Rafa's logos start at 15,000 taka.",
		"Rafa will see your message later.",
		"Rafa takes calls on Monday from 10 am to 12 pm.",
		"Rafa takes calls on Mondays (সোমবার) from 10:00 to 12:00.",
		"রাফা পরে আপনার মেসেজ দেখবেন।",
	}
	for _, text := range passes {
		if got := CheckReply(text, rafa); got != "" {
			t.Errorf("%q may go: got %q", text, got)
		}
	}
	stops := []string{
		"Sure, Rafa can meet you tomorrow at 3 pm.",
		"Rafa is free at 15:00.",
		"Rafa can call you at 3:30 p.m.",
		"Let's say 4 o'clock.",
		"Rafa takes calls on Monday from 10 am to 1 pm.",
		"See you on Friday!",
		"Rafa is in the office today.",
		"Your meeting with Rafa is confirmed.",
		"You're booked in.",
		"It’s a deal.",
		"Agreed.",
		"রাফা আগামীকাল ৩টায় আপনার সাথে দেখা করবেন।",
		"আজ বিকেল ৩টা হলে চলবে।",
		"ঠিক আছে, কালকে কথা হবে।",
		"শুক্রবারে রাফা ফ্রি আছেন।",
		"রাফা ১৫:০০ টায় ফ্রি।",
		"আপনার সাথে দেখা হবে।",
		"আপনার মিটিং কনফার্ম করা হয়েছে।",
		// "Rafa is free at 3", with য় as one character and as two.
		"রাফা ৩টায় ফ্রি থাকবেন।",
		"রাফা ৩টায় ফ্রি থাকবেন।",
	}
	for _, text := range stops {
		if got := CheckReply(text, rafa); got != ReasonNeedsDecision {
			t.Errorf("%q must stop: got %q", text, got)
		}
	}
	// A made-up price is still the price check's to stop.
	if got := CheckReply("Agreed, 20,000 taka then.", rafa); got != ReasonPriceNotOnMenu {
		t.Errorf("a made-up price: got %q", got)
	}
}

// Words that only look like a day or an agreement never stop a reply:
// "সকাল" (morning) and "কালো" (black) hold কাল, "আজব" (strange) and
// "আজকাল" (nowadays) begin with আজ, a customer named রাজিব isn't রাজি
// (agreed), and 15,000 is no clock time.
func TestWordsThatOnlyLookLikeACommitmentPass(t *testing.T) {
	for _, text := range []string{
		"রাফা সকালে আপনার মেসেজ দেখবেন।",
		"রাফা কালো রঙের লোগো পছন্দ করেন।",
		"আজকাল রাফা লোগো ডিজাইন করেন।",
		"আজব প্রশ্ন, রাজিব!",
		"Hi Rajib, Rafa's logos start at 15,000 taka.",
		"Rafa will see your message and get back to you.",
	} {
		if got := CheckReply(text, rafa); got != "" {
			t.Errorf("%q: got %q", text, got)
		}
	}
}

// A business's replies name times and days all day ("we open at 18:00
// tomorrow"): only a person's are checked.
func TestABusinessMayNameTimesAndDays(t *testing.T) {
	business := CheckData{Currency: "EUR", MenuPrices: []int64{950}}
	if got := CheckReply("See you tomorrow: we open at 18:00, booking confirmed.", business); got != "" {
		t.Fatalf("a business's reply: %q", got)
	}
}
