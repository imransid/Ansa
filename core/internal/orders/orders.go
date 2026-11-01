// Package orders: what a customer orders in a chat, collected by the
// assistant and written up by ansa (the old lib/orders.ts and
// lib/order-steps.ts). The AI only names dishes by their menu labels and how
// many; every price, line and total is ansa's own, from today's menu. The
// pricing, the texts and the step plan are pure; store.go saves the rows.
package orders

import (
	"strconv"
	"strings"

	"ansa/core/internal/money"
)

// Limits, as the database's CHECKs repeat them.
const (
	QuantityMax = 50
	LinesMax    = 30
)

// Request is what the AI says the customer wants, by menu label (M1, M2...).
type Request struct {
	Items      []Item `json:"items"`
	Fulfilment string `json:"fulfilment"`
	Address    string `json:"address"`
	Time       string `json:"time"`
	Notes      string `json:"notes"`
}

// Item is one dish by its label, and how many.
type Item struct {
	Label    string `json:"label"`
	Quantity int    `json:"quantity"`
}

// MenuChoice is a dish as the assistant's menu listed it today.
type MenuChoice struct {
	Label      string
	Name       string
	PriceCents int64
}

// Options is what the business offers for orders (Settings → What it knows).
type Options struct {
	Delivery, Pickup bool
	DeliveryFeeCents int64
	Currency         string
}

// Line is one priced line of an order.
type Line struct {
	Name                           string
	Quantity                       int
	UnitPriceCents, LineTotalCents int64
}

// Priced is an order with ansa's prices and total.
type Priced struct {
	Lines                                       []Line
	Fulfilment, Address, Time, Notes, Currency  string
	SubtotalCents, DeliveryFeeCents, TotalCents int64
}

// Why ansa can't write up the order yet: a fixed question each, or a person
// for a dish it can't place.
const (
	GapUnknownItem = "unknown_item"
	GapNoItems     = "no_items"
	GapHow         = "how"
	GapAddress     = "address"
)

// Price writes up the order, or says what is missing. The same label twice
// adds up into one line.
func Price(request Request, menu []MenuChoice, options Options) (Priced, string) {
	var lines []Line
	for _, item := range request.Items {
		dish, found := findDish(menu, item.Label)
		if !found || item.Quantity < 1 || item.Quantity > QuantityMax {
			return Priced{}, GapUnknownItem
		}
		lines = addLine(lines, dish, item.Quantity)
	}
	if len(lines) == 0 {
		return Priced{}, GapNoItems
	}
	if len(lines) > LinesMax {
		return Priced{}, GapUnknownItem
	}
	fulfilment := ""
	switch {
	case request.Fulfilment == "delivery" && options.Delivery:
		fulfilment = "delivery"
	case request.Fulfilment == "pickup" && options.Pickup:
		fulfilment = "pickup"
	default:
		return Priced{}, GapHow
	}
	address := strings.TrimSpace(request.Address)
	if fulfilment == "delivery" && address == "" {
		return Priced{}, GapAddress
	}
	order := Priced{Lines: lines, Fulfilment: fulfilment, Time: strings.TrimSpace(request.Time), Notes: strings.TrimSpace(request.Notes), Currency: options.Currency}
	if fulfilment == "delivery" {
		order.Address = address
		order.DeliveryFeeCents = options.DeliveryFeeCents
	}
	if order.Time == "" {
		order.Time = "As soon as possible"
	}
	for _, line := range lines {
		order.SubtotalCents += line.LineTotalCents
	}
	order.TotalCents = order.SubtotalCents + order.DeliveryFeeCents
	return order, ""
}

func findDish(menu []MenuChoice, label string) (MenuChoice, bool) {
	wanted := strings.ToUpper(strings.TrimSpace(label))
	for _, dish := range menu {
		if dish.Label == wanted {
			return dish, true
		}
	}
	return MenuChoice{}, false
}

func addLine(lines []Line, dish MenuChoice, quantity int) []Line {
	for i := range lines {
		if lines[i].Name == dish.Name && lines[i].UnitPriceCents == dish.PriceCents {
			lines[i].Quantity = min(lines[i].Quantity+quantity, QuantityMax)
			lines[i].LineTotalCents = int64(lines[i].Quantity) * lines[i].UnitPriceCents
			return lines
		}
	}
	return append(lines, Line{Name: dish.Name, Quantity: quantity, UnitPriceCents: dish.PriceCents, LineTotalCents: int64(quantity) * dish.PriceCents})
}

// Question is ansa's question for what is missing (never the AI's words).
func Question(gap string, options Options) string {
	switch {
	case gap == GapNoItems:
		return "What would you like to order?"
	case gap == GapAddress:
		return "Where should we deliver it? Please send the full address."
	case options.Delivery && options.Pickup:
		return "Would you like it delivered, or will you pick it up?"
	case options.Delivery:
		return "We deliver: where should we bring it? Please send the full address."
	}
	return "We don't deliver, but you can pick it up. Is pickup all right?"
}

// SummaryText is what the customer says yes to: every line, the fee, the
// total, how and when, written by ansa from the priced order.
func SummaryText(order Priced) string {
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

// PlacedText confirms a placed order (sent at once, never waits).
func PlacedText(number int) string {
	return "Thank you! Your order #" + strconv.Itoa(number) + " is placed. We'll message you as soon as it's accepted."
}

// WithdrawnText answers a customer who doesn't want the order after all.
const WithdrawnText = "No problem: nothing was ordered."

// ClosedText: closed now by the business's own hours ("Opens at 18:00").
func ClosedText(hoursNow string) string {
	return "Sorry, we can't take orders right now (" + strings.ToLower(hoursNow) + ")."
}

// StatusText is the short message a person's button sends the customer.
func StatusText(change string, number int, fulfilment string, wasNew bool) string {
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
