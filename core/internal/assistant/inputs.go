package assistant

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/hours"
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
	// Menu labels (M1...) to the dish's name and price, for orders.
	Menu []MenuChoice
}

// MenuChoice is one available dish as the brain's menu labels it.
type MenuChoice struct {
	Label      string
	Name       string
	PriceCents int64
}

type settingsRow struct {
	Currency, DeliveryNote, PaymentNote, Instructions, HoldingReply, ReplyMode string
	Delivery, Pickup, TakesOrders                                              bool
	DeliveryFeeCents                                                           int64
	TimeZone, PublicPhone, KeyEncrypted                                        *string
	OpeningHours, AwayHours                                                    []byte
	AwaySince                                                                  *time.Time
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
	lines, err := conversationLines(ctx, pool, box, company, conversationID)
	if err != nil {
		return nil, err
	}
	categories, err := activeCategories(ctx, pool, company)
	if err != nil {
		return nil, err
	}
	name := firstNonEmpty(facts["company_name"], companyName)
	takesOrders := kind == "business" && settings.TakesOrders
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
	}
	if fee > 0 {
		formatted := FormatMoney(fee, settings.Currency)
		request.Orders.DeliveryFee = &formatted
	}
	choices := make([]MenuChoice, 0, len(menu))
	prices := make([]int64, 0, len(menu)+1)
	for index, dish := range menu {
		label := fmt.Sprintf("M%d", index+1)
		request.Menu = append(request.Menu, MenuItem{Label: label, Category: dish.category, Name: dish.name, Description: dish.description, Price: FormatMoney(dish.priceCents, settings.Currency)})
		choices = append(choices, MenuChoice{Label: label, Name: dish.name, PriceCents: dish.priceCents})
		prices = append(prices, dish.priceCents)
	}
	if fee > 0 {
		prices = append(prices, fee)
	}
	request.Hours = hoursFor(kind, settings, now)
	return &Inputs{
		Request:      request,
		Checks:       CheckData{Currency: settings.Currency, MenuPrices: prices, OwnerTexts: []string{settings.Instructions, settings.DeliveryNote, settings.PaymentNote, facts["description"]}},
		Name:         name,
		Kind:         kind,
		HoldingReply: settings.HoldingReply,
		ReplyMode:    settings.ReplyMode,
		Menu:         choices,
	}, nil
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

func readSettings(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (settingsRow, error) {
	const statement = `
		SELECT COALESCE(currency, 'EUR'), delivery_note, payment_note, instructions, holding_reply, reply_mode,
			delivery, pickup, takes_orders, delivery_fee_cents, time_zone, public_phone, anthropic_key_encrypted,
			opening_hours, away_hours, away_since
		FROM assistant_settings WHERE company_id = $1`
	s := settingsRow{Currency: "EUR", Pickup: true, TakesOrders: true, ReplyMode: "automatic", HoldingReply: defaultHoldingReply}
	err := pool.QueryRow(ctx, statement, company.String()).Scan(&s.Currency, &s.DeliveryNote, &s.PaymentNote, &s.Instructions, &s.HoldingReply, &s.ReplyMode,
		&s.Delivery, &s.Pickup, &s.TakesOrders, &s.DeliveryFeeCents, &s.TimeZone, &s.PublicPhone, &s.KeyEncrypted, &s.OpeningHours, &s.AwayHours, &s.AwaySince)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, nil
	}
	return s, err
}

// The holding reply until an owner writes their own (lib/restaurant-setup.ts).
const defaultHoldingReply = "Thank you for your message. Our team will get back to you as soon as possible."

func readFacts(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (map[string]string, error) {
	rows, err := pool.Query(ctx, `SELECT topic, COALESCE(confirmed_value, '') FROM business_facts WHERE company_id = $1 AND topic IN ('company_name', 'description', 'location')`, company.String())
	if err != nil {
		return nil, fmt.Errorf("facts: %w", err)
	}
	facts := map[string]string{}
	for rows.Next() {
		var topic, value string
		if err := rows.Scan(&topic, &value); err != nil {
			return nil, err
		}
		facts[topic] = value
	}
	return facts, rows.Err()
}

type dish struct {
	category, name, description string
	priceCents                  int64
}

// readMenu lists the dishes available now (a person has none).
func readMenu(ctx context.Context, pool *database.Pool, company tenant.CompanyID, kind, _ string) ([]dish, error) {
	if kind == "personal" {
		return nil, nil
	}
	const statement = `
		SELECT category, name, description, price_cents FROM catalog_items
		WHERE company_id = $1 AND (unavailable_until IS NULL OR unavailable_until <= now())
		ORDER BY position, id`
	rows, err := pool.Query(ctx, statement, company.String())
	if err != nil {
		return nil, fmt.Errorf("menu: %w", err)
	}
	var menu []dish
	for rows.Next() {
		var d dish
		if err := rows.Scan(&d.category, &d.name, &d.description, &d.priceCents); err != nil {
			return nil, err
		}
		menu = append(menu, d)
	}
	return menu, rows.Err()
}

// conversationLines are the newest texts of the conversation, oldest first,
// decrypted; drafts, discarded and failed messages never reached the customer.
func conversationLines(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, conversationID string) ([]Line, error) {
	const statement = `
		SELECT id, author, body_encrypted FROM messages
		WHERE company_id = $1 AND conversation_id = $2 AND body_encrypted IS NOT NULL
			AND (send_status IS NULL OR send_status NOT IN ('draft', 'discarded', 'failed'))
		ORDER BY created_at DESC LIMIT $3`
	rows, err := pool.Query(ctx, statement, company.String(), conversationID, conversationLinesSent)
	if err != nil {
		return nil, fmt.Errorf("conversation: %w", err)
	}
	var newestFirst []Line
	for rows.Next() {
		var id, author, body string
		if err := rows.Scan(&id, &author, &body); err != nil {
			return nil, err
		}
		text, err := box.Decrypt(body, conversations.MessageContext(company, id))
		if err != nil {
			continue
		}
		sender := "restaurant"
		if author == "customer" {
			sender = "customer"
		}
		newestFirst = append(newestFirst, Line{Sender: sender, Text: text})
	}
	lines := make([]Line, 0, len(newestFirst))
	for i := len(newestFirst) - 1; i >= 0; i-- {
		lines = append(lines, newestFirst[i])
	}
	return lines, rows.Err()
}

func activeCategories(ctx context.Context, pool *database.Pool, company tenant.CompanyID) ([]string, error) {
	rows, err := pool.Query(ctx, `SELECT name FROM categories WHERE company_id = $1 AND archived_at IS NULL ORDER BY name`, company.String())
	if err != nil {
		return nil, fmt.Errorf("categories: %w", err)
	}
	names := []string{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, rows.Err()
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
