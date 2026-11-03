package assistant

// Why the assistant handed a conversation to a person, in plain words for
// the request and the owner's alert (the old lib/assistant/reasons.ts).
var ReasonText = map[string]string{
	"unsure":            "The assistant wasn't sure how to answer.",
	"complaint":         "They complained.",
	"refund":            "They asked for a refund or compensation.",
	"asked_for_person":  "They asked to talk to a person.",
	"order":             "They want to place an order or book a table.",
	"needs_decision":    "It needs your decision.",
	"important_person":  "They're one of your important people.",
	"price_not_on_menu": "The assistant's reply named a price that isn't on your menu, so ansa didn't send it.",
	"refund_promise":    "The assistant's reply promised a refund or compensation, so ansa didn't send it.",
	"unknown_link":      "The assistant's reply had a link ansa doesn't know, so ansa didn't send it.",
	"unusable_answer":   "The assistant's answer couldn't be read.",
	"model_failed":      "The AI didn't answer in time.",
	"model_unavailable": "No AI is set up for the assistant (Settings → Assistant → AI engine).",
	"reply_limit":       "The assistant reached its replies for this hour.",
	"send_failed":       "The assistant's reply couldn't be sent.",
	"order_change":      "They want to change or cancel an order they placed.",
	"order_unclear":     "ansa couldn't write up their order (a dish it couldn't find on the menu).",
	"call_message":      "They called and left a message.",
	"package_used_up":   "Your package has no AI replies left this month (or the free trial ended), so ansa sent your holding reply. See Billing.",
	"not_in_package":    "Your package doesn't include this channel, so ansa sent your holding reply. See Billing.",
	// Only a request's and an alert's (callNoteReason): its activity row is "call_needs_person".
	"call_note": "After their call, ansa noted something that waits for you.",
}

// personalReasonText: the same reasons for one person's account, where the
// business words don't fit (a person has no menu).
var personalReasonText = map[string]string{
	"price_not_on_menu": "The assistant's reply named an amount that isn't in your own notes or saved answers, so ansa didn't send it.",
}

// ReasonTextFor is a reason in plain words for this kind of account
// ("business" or "personal").
func ReasonTextFor(reason, kind string) string {
	if text, ok := personalReasonText[reason]; ok && kind == "personal" {
		return text
	}
	return ReasonText[reason]
}

// stoppedSubjects: the subject of a request about a reply ansa's own
// checks stopped, saying why, instead of "<Channel> conversation needs you"
// (the AI wrote none: its reply never went).
var stoppedSubjects = map[string]string{
	ReasonPriceNotOnMenu: "Reply stopped: a price not on your menu",
	ReasonRefundPromise:  "Reply stopped: it promised a refund",
	ReasonUnknownLink:    "Reply stopped: an unknown link",
}

// personalStoppedSubjects: the same for one person (no menu; only their
// replies are checked for commitments).
var personalStoppedSubjects = map[string]string{
	ReasonPriceNotOnMenu: "Reply stopped: an amount not in your notes",
	ReasonNeedsDecision:  "Reply stopped: it would commit you",
}

// stoppedSubject is that subject for this kind of account ("" for a reason
// none of the checks gives).
func stoppedSubject(reason, kind string) string {
	if subject, ok := personalStoppedSubjects[reason]; ok && kind == "personal" {
		return subject
	}
	return stoppedSubjects[reason]
}

// reasonWords is a request's reason in plain words for this kind of
// account, naming the amount ansa's price check stopped when there is one
// (the customer's own price the AI repeated, or one it made up).
func reasonWords(reason, stoppedAmount, kind string) string {
	if reason != ReasonPriceNotOnMenu || stoppedAmount == "" {
		return ReasonTextFor(reason, kind)
	}
	if kind == "personal" {
		return "The assistant's reply named the amount " + stoppedAmount + ", which isn't in your own notes or saved answers, so ansa didn't send it."
	}
	return "The assistant's reply named the price " + stoppedAmount + ", which isn't on your menu, so ansa didn't send it."
}

// ChannelLabels name a conversation's channel for people.
var ChannelLabels = map[string]string{
	"telegram": "Telegram", "messenger": "Messenger", "whatsapp": "WhatsApp", "phone": "Phone", "email": "Email", "stand_in": "Stand-in chat",
}
