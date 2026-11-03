package orders

import (
	"strconv"
	"strings"

	"ansa/core/internal/money"
)

// ansa's own fixed texts for an order: its questions, the summary the
// customer says yes to, and the messages after it. Never the AI's words.
// Each is in the customer's language (LanguageOf: Bangla or English; the
// Bangla words are in texts_bangla.go).

// Question is ansa's question for what is missing (never the AI's words).
func Question(gap string, options Options, language string) string {
	if language == Bangla {
		return questionBangla(gap, options)
	}
	switch {
	case gap == GapNoItems:
		return "What would you like to order?"
	case gap == GapAddress:
		return "Where should we deliver it? Please send the full address."
	case options.Delivery && options.Pickup:
		return "Would you like it delivered, or will you pick it up?"
	case options.Delivery:
		return "We deliver: where should we bring it? Please send the full address."
	case options.Pickup:
		return "We don't deliver, but you can pick it up. Is pickup all right?"
	}
	// Neither (PlanStep hands such an order to a person first): no way is promised.
	return "Sorry, we can't take orders right now."
}

// SpokenQuestion is Question for a live call: the caller tells, never sends.
func SpokenQuestion(gap string, options Options, language string) string {
	if language == Bangla {
		return strings.Replace(questionBangla(gap, options), sendTheAddressBangla, tellTheAddressBangla, 1)
	}
	return strings.Replace(Question(gap, options, English), "Please send the full address.", "Please tell me the full address.", 1)
}

// SummaryText is what the customer says yes to: every line, the fee, the
// total, how and when, written by ansa from the priced order.
func SummaryText(order Priced, language string) string {
	if language == Bangla {
		return summaryBangla(order)
	}
	price := func(cents int64) string { return money.Format(cents, order.Currency) }
	lines := []string{"Here is your order:"}
	for _, line := range order.Lines {
		lines = append(lines, strconv.Itoa(line.Quantity)+" × "+line.Name+": "+price(line.LineTotalCents))
	}
	if order.DeliveryFeeCents > 0 {
		lines = append(lines, "Delivery: "+price(order.DeliveryFeeCents))
	}
	lines = append(lines, "Total: "+price(order.TotalCents))
	if order.Fulfilment == "delivery" {
		lines = append(lines, "Delivery to: "+order.Address)
	} else {
		lines = append(lines, "Pickup")
	}
	lines = append(lines, "When: "+order.Time)
	if order.Notes != "" {
		lines = append(lines, "Notes: "+order.Notes)
	}
	return strings.Join(append(lines, "", "Shall I place the order? Reply “yes” to confirm."), "\n")
}

// SpokenSummaryText is SummaryText for a live call: the same lines as
// sentences a voice reads well ("2 Margherita, €17.00."), and "say yes",
// since a caller doesn't reply in writing. It keeps "Here is your order"
// ("আপনার অর্ডার" in Bangla), which the assistant looks for to know what a
// yes answers.
func SpokenSummaryText(order Priced, language string) string {
	if language == Bangla {
		return spokenSummaryBangla(order)
	}
	price := func(cents int64) string { return money.Format(cents, order.Currency) }
	parts := []string{"Here is your order:"}
	for _, line := range order.Lines {
		parts = append(parts, strconv.Itoa(line.Quantity)+" "+line.Name+", "+price(line.LineTotalCents)+".")
	}
	if order.DeliveryFeeCents > 0 {
		parts = append(parts, "Delivery, "+price(order.DeliveryFeeCents)+".")
	}
	parts = append(parts, "Total, "+price(order.TotalCents)+".")
	if order.Fulfilment == "delivery" {
		parts = append(parts, "Delivered to "+order.Address+".")
	} else {
		parts = append(parts, "For pickup.")
	}
	parts = append(parts, "When: "+order.Time+".")
	if order.Notes != "" {
		parts = append(parts, "Notes: "+order.Notes+".")
	}
	return strings.Join(append(parts, "Shall I place the order? Please say yes to confirm."), " ")
}

// PlacedText confirms a placed order (sent at once, never waits).
func PlacedText(number int, language string) string {
	if language == Bangla {
		return "ধন্যবাদ! আপনার অর্ডার #" + strconv.Itoa(number) + " দেওয়া হয়েছে। অর্ডারটি গ্রহণ করা হলেই আমরা আপনাকে মেসেজ করে জানাব।"
	}
	return "Thank you! Your order #" + strconv.Itoa(number) + " is placed. We'll message you as soon as it's accepted."
}

// SpokenPlacedText confirms an order placed on a call: nobody can message a
// caller afterwards, so it promises nothing more.
func SpokenPlacedText(number int, language string) string {
	if language == Bangla {
		return "ধন্যবাদ! আপনার অর্ডার নম্বর " + strconv.Itoa(number) + " দেওয়া হয়েছে।"
	}
	return "Thank you! Your order number " + strconv.Itoa(number) + " is placed."
}

// WithdrawnText answers a customer who doesn't want the order after all.
func WithdrawnText(language string) string {
	if language == Bangla {
		return "কোনো সমস্যা নেই: কোনো অর্ডার দেওয়া হয়নি।"
	}
	return "No problem: nothing was ordered."
}

// ClosedText: closed now by the business's own hours ("Opens at 18:00").
func ClosedText(hoursNow string, language string) string {
	if language == Bangla {
		return "দুঃখিত, এই মুহূর্তে আমরা অর্ডার নিতে পারছি না (" + hoursBangla(hoursNow) + ")।"
	}
	return "Sorry, we can't take orders right now (" + strings.ToLower(hoursNow) + ")."
}

// StatusText is the short message a person's button sends the customer.
func StatusText(change string, number int, fulfilment string, wasNew bool, language string) string {
	if language == Bangla {
		return statusBangla(change, number, fulfilment, wasNew)
	}
	n := "#" + strconv.Itoa(number)
	switch change {
	case "accept":
		return "Your order " + n + " is accepted. We're getting it ready."
	case "ready":
		if fulfilment == "delivery" {
			return "Your order " + n + " is on its way."
		}
		return "Your order " + n + " is ready to pick up."
	case "done":
		return "Thank you for your order " + n + "!"
	}
	if wasNew {
		return "Sorry, we can't take your order " + n + ". Write to us here if you have any questions."
	}
	return "Sorry, your order " + n + " was cancelled. Write to us here if you have any questions."
}
