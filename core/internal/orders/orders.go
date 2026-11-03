// Package orders: what a customer orders in a chat, collected by the
// assistant and written up by ansa (the old lib/orders.ts and
// lib/order-steps.ts). The AI only names dishes by their menu labels and how
// many; every price, line and total is ansa's own, from today's menu. The
// pricing, the texts (texts.go) and the step plan are pure; store.go saves
// the rows.
package orders

import (
	"math"
	"strings"
)

// Limits, as the database's CHECKs repeat them.
const (
	QuantityMax = 50
	LinesMax    = 30
)

// amountMax is the most an order's line, subtotal or total may be: the
// database holds them as 32-bit integers. A bigger order goes to a person,
// as a dish ansa can't place does (an INSERT that failed left the customer
// without an answer).
const amountMax = math.MaxInt32

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

// The wanted time when the customer didn't say (the Orders page shows it;
// a Bangla summary says it in Bangla).
const asSoonAsPossible = "As soon as possible"

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
	subtotal, fits := subtotalOf(lines)
	if len(lines) > LinesMax || !fits {
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
		order.Time = asSoonAsPossible
	}
	order.SubtotalCents = subtotal
	order.TotalCents = order.SubtotalCents + order.DeliveryFeeCents
	if order.TotalCents > amountMax {
		return Priced{}, GapUnknownItem
	}
	return order, ""
}

// subtotalOf adds the lines up; false when a line or the sum is past amountMax.
func subtotalOf(lines []Line) (int64, bool) {
	subtotal := int64(0)
	for _, line := range lines {
		if line.LineTotalCents > amountMax {
			return 0, false
		}
		subtotal += line.LineTotalCents
	}
	return subtotal, subtotal <= amountMax
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
