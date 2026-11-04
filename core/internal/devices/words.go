package devices

import (
	"ansa/core/internal/assistant"
	"ansa/core/internal/plaintext"
)

// How the web Home words a line of "What ansa did": the screens'
// ACTIVITY_TEXT (lib/conversations.ts), the same words for the app, so the
// phone never shows a code. words_test.go keeps the two lists equal.
var activityText = map[string]string{
	"call_solved":        "Answered a call",
	"call_needs_person":  "Took a call and kept a note for you",
	"email_made_request": "Read an email and kept a note for you",
	"taken_over":         "Taken over by a person",
	"handed_back":        "Handed back to ansa",
	"replied":            "Answered a message",
	"drafted":            "Wrote a reply for you to check",
	"handed_over":        "Told them you'll get back to them",
	"draft_sent":         "Sent ansa's reply",
	"draft_discarded":    "Discarded ansa's reply",
	"order_placed":       "Took an order",
}

// The phones' own lines (phone_presence_changes).
var presenceText = map[string]string{
	changeAway: "Your phone was unreachable: ansa answers for you",
	changeBack: "Your phone is back: you're available again",
}

// The chat channels: a nameless customer there is "<app> customer" (the
// screens' contactLabel); a caller or a sender without a name is "a customer".
var chatChannels = map[string]bool{"telegram": true, "messenger": true, "whatsapp": true, "stand_in": true}

// activityWords is a line's words ("" for an action the screens don't word either).
func activityWords(action string) string {
	return activityText[action]
}

// customerLabel names a line's customer as the web Home does: their name
// as the channel gave it (one plain line), "Telegram customer" on a chat,
// else "a customer".
func customerLabel(name *string, channel string) string {
	if name != nil {
		if clean := plaintext.SingleLine(*name); clean != "" {
			return clean
		}
	}
	if chatChannels[channel] {
		return assistant.ChannelLabels[channel] + " customer"
	}
	return "a customer"
}
