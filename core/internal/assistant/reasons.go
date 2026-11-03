package assistant

// Why the assistant handed a conversation to a person, in plain words for
// the request and the owner's alert (the old lib/assistant/reasons.ts).
var ReasonText = map[string]string{
	"unsure":            "The assistant wasn't sure how to answer.",
	"complaint":         "They complained.",
	"refund":            "They asked for a refund or compensation.",
	"asked_for_person":  "They asked to talk to a person.",
	"order":             "They want to place an order.",
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

// ChannelLabels name a conversation's channel for people.
var ChannelLabels = map[string]string{
	"telegram": "Telegram", "messenger": "Messenger", "whatsapp": "WhatsApp", "phone": "Phone", "email": "Email", "stand_in": "Stand-in chat",
}
