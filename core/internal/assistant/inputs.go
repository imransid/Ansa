package assistant

import (
	"context"
	"fmt"
	"strings"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/hours"
	"ansa/core/internal/money"
	"ansa/core/internal/orders"
	"ansa/core/internal/packages"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// How many of the conversation's newest messages the brain reads.
const conversationLinesSent = 20

// Inputs is everything one reply needs: the brain's slice, and what core
// itself checks the answer against and sends with it.
type Inputs struct {
	Request      BrainRequest
	Checks       CheckData
	Name         string
	Kind         string
	HoldingReply string
	ReplyMode    string
	// What ansa needs to write up an order itself: today's menu by label,
	// whether it takes orders, closed now, delivery and pickup, the fee.
	Ordering orders.Ordering
	// The business saved its own key and it can't be read: ansa's key is
	// never used in its place (nobody pays unaware), so no AI answers.
	KeyUnreadable bool
	// The business's own Claude key answers (its replies aren't counted
	// against its package), and the package it has now (step 57).
	OwnKey  bool
	Package packages.Package
	// This answer is a live call's (onACall): spoken, never a draft.
	Spoken bool
}

// onACall makes this answer a live call's (step 55): the brain writes for a
// voice, ansa's order texts are the spoken ones, and the words go to the
// call (routeWithin) and never wait as a draft: the caller is on the line.
// messageOnly: the AI may only take a message (CallTakesMessagesOnly).
func (i *Inputs) onACall(messageOnly bool) {
	i.Spoken = true
	i.Request.Channel = "call"
	i.Ordering.Spoken = true
	if messageOnly {
		i.Request.CallMode = "message_only"
	}
}

type settingsRow struct {
	Currency, DeliveryNote, PaymentNote, Instructions, HoldingReply, ReplyMode, AIEngine string
	Delivery, Pickup, TakesOrders                                                        bool
	DeliveryFeeCents                                                                     int64
	TimeZone, PublicPhone, KeyEncrypted                                                  *string
	OpeningHours, AwayHours                                                              []byte
	AwaySince                                                                            *time.Time
}

// GatherInputs reads one company's slice for an answer in this conversation.
func GatherInputs(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, conversationID string, now time.Time) (*Inputs, error) {
	settings, err := readSettings(ctx, pool, company)
	if err != nil {
		return nil, fmt.Errorf("settings: %w", err)
	}
	var kind, companyName string
	if err := pool.QueryRow(ctx, `SELECT kind, name FROM companies WHERE id = $1`, company.String()).Scan(&kind, &companyName); err != nil {
		return nil, fmt.Errorf("company: %w", err)
	}
	facts, err := readFacts(ctx, pool, company)
	if err != nil {
		return nil, err
	}
	menu, err := readMenu(ctx, pool, company, kind, settings.Currency)
	if err != nil {
		return nil, err
	}
	// No conversation (the owner's test box): its caller puts the typed message in.
	lines := []Line{}
	if conversationID != "" {
		if lines, err = conversationLines(ctx, pool, box, company, conversationID); err != nil {
			return nil, err
		}
	}
	categories, err := activeCategories(ctx, pool, company)
	if err != nil {
		return nil, err
	}
	name := firstNonEmpty(facts["company_name"], companyName)
	pkg, err := packages.Of(ctx, pool, company, now)
	if err != nil {
		return nil, fmt.Errorf("package: %w", err)
	}
	// Orders come with the packages that include them (step 57).
	takesOrders := kind == "business" && settings.TakesOrders && pkg.Orders
	fee := int64(0)
	if settings.Delivery {
		fee = settings.DeliveryFeeCents
	}
	request := BrainRequest{
		Kind:         kind,
		Business:     Business{Name: name, Description: facts["description"], Address: facts["location"], Phone: settings.PublicPhone},
		Ordering:     Ordering{Delivery: settings.Delivery, DeliveryNote: settings.DeliveryNote, Pickup: settings.Pickup, PaymentNote: settings.PaymentNote},
		Orders:       Orders{TakesOrders: takesOrders, InProgress: []string{}, Placed: []string{}},
		Menu:         []MenuItem{},
		Instructions: settings.Instructions,
		Categories:   categories,
		Conversation: lines,
		Channel:      "chat",
		CallMode:     "answer",
	}
	if fee > 0 {
		formatted := money.Format(fee, settings.Currency)
		request.Orders.DeliveryFee = &formatted
	}
	choices := make([]orders.MenuChoice, 0, len(menu))
	prices := make([]int64, 0, len(menu)+1)
	for index, dish := range menu {
		label := fmt.Sprintf("M%d", index+1)
		request.Menu = append(request.Menu, MenuItem{Label: label, Category: dish.category, Name: dish.name, Description: dish.description, Price: money.Format(dish.priceCents, settings.Currency)})
		choices = append(choices, orders.MenuChoice{Label: label, Name: dish.name, PriceCents: dish.priceCents})
		prices = append(prices, dish.priceCents)
	}
	if fee > 0 {
		prices = append(prices, fee)
	}
	request.Hours = hoursFor(kind, settings, now)
	if takesOrders && conversationID != "" {
		if err := describeOrders(ctx, pool, company, conversationID, choices, &request.Orders); err != nil {
			return nil, err
		}
	}
	request.Engine = settings.AIEngine
	keyUnreadable := false
	if settings.AIEngine == "api_key" && settings.KeyEncrypted != nil {
		key, err := box.Decrypt(*settings.KeyEncrypted, KeyContext(company))
		if err != nil {
			keyUnreadable = true
		} else {
			request.APIKey = &key
		}
	}
	return &Inputs{
		KeyUnreadable: keyUnreadable,
		OwnKey:        request.APIKey != nil,
		Package:       pkg,
		Request:       request,
		Checks:        CheckData{Currency: settings.Currency, MenuPrices: prices, OwnerTexts: []string{settings.Instructions, settings.DeliveryNote, settings.PaymentNote, facts["description"]}},
		Name:          name,
		Kind:          kind,
		HoldingReply:  settings.HoldingReply,
		ReplyMode:     settings.ReplyMode,
		Ordering: orders.Ordering{
			TakesOrders: takesOrders,
			ClosedNow:   closedNow(takesOrders, settings, now),
			Menu:        choices,
			Options:     orders.Options{Delivery: settings.Delivery, Pickup: settings.Pickup, DeliveryFeeCents: fee, Currency: settings.Currency},
		},
	}, nil
}

// describeOrders gives the brain this conversation's order being written up
// and its newest 3 placed ones, each line with its menu label.
func describeOrders(ctx context.Context, pool *database.Pool, company tenant.CompanyID, conversationID string, menu []orders.MenuChoice, into *Orders) error {
	proposal, placed, err := orders.OfConversation(ctx, pool, company, conversationID, 3)
	if err != nil {
		return fmt.Errorf("orders: %w", err)
	}
	if proposal != nil {
		into.InProgress = orders.DescribeForAssistant(*proposal, menu)
	}
	for _, order := range placed {
		into.Placed = append(into.Placed, fmt.Sprintf("#%d: %s, %s", order.Number, order.Status, strings.Join(orders.DescribeForAssistant(order, menu), ", ")))
	}
	return nil
}

// closedNow is "Opens at 18:00" while the business is closed now by its own
// hours; "" while open, or when it gave no hours (nothing to go by).
func closedNow(takesOrders bool, s settingsRow, now time.Time) string {
	if !takesOrders || s.TimeZone == nil {
		return ""
	}
	week, ok := hours.Parse(s.OpeningHours)
	zone, err := time.LoadLocation(*s.TimeZone)
	if !ok || err != nil {
		return ""
	}
	if open, text := hours.Now(week, zone, now); !open {
		return text
	}
	return ""
}

// hoursFor is "now" and the week as the brain reads them: a business's
// opening hours, or a person's away hours and whether they said they're away.
func hoursFor(kind string, s settingsRow, now time.Time) *Hours {
	zoneName := "UTC"
	if s.TimeZone != nil {
		zoneName = *s.TimeZone
	}
	zone, err := time.LoadLocation(zoneName)
	if err != nil {
		return nil
	}
	local := now.In(zone).Format("Monday 15:04")
	if kind == "personal" {
		result := &Hours{TimeZone: zoneName, Now: local, Weekly: []string{}}
		if s.AwaySince != nil {
			result.Now += ", they said they are away"
		}
		if week, ok := hours.Parse(s.AwayHours); ok {
			for _, day := range hours.Weekdays {
				described := hours.DescribeDay(week[day.Key])
				if described == "Closed" {
					described = "no set hours"
				}
				result.Weekly = append(result.Weekly, "Away on "+day.Label+": "+described)
			}
		}
		return result
	}
	week, ok := hours.Parse(s.OpeningHours)
	if s.TimeZone == nil || !ok {
		return nil
	}
	_, text := hours.Now(week, zone, now)
	result := &Hours{TimeZone: zoneName, Now: local + ", " + strings.ToLower(text)}
	for _, day := range hours.Weekdays {
		result.Weekly = append(result.Weekly, day.Label+": "+hours.DescribeDay(week[day.Key]))
	}
	return result
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
