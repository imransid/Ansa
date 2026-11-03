package assistant

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// The reads behind GatherInputs: one company's settings, facts, menu,
// categories and the newest lines of one conversation.

func readSettings(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (settingsRow, error) {
	const statement = `
		SELECT COALESCE(currency, 'EUR'), delivery_note, payment_note, instructions, holding_reply, reply_mode,
			delivery, pickup, takes_orders, delivery_fee_cents, time_zone, public_phone, anthropic_key_encrypted,
			opening_hours, away_hours, away_since, ai_engine
		FROM assistant_settings WHERE company_id = $1`
	s := settingsRow{Currency: "EUR", Pickup: true, TakesOrders: true, ReplyMode: "automatic", HoldingReply: defaultHoldingReply, AIEngine: "api_key"}
	err := pool.QueryRow(ctx, statement, company.String()).Scan(&s.Currency, &s.DeliveryNote, &s.PaymentNote, &s.Instructions, &s.HoldingReply, &s.ReplyMode,
		&s.Delivery, &s.Pickup, &s.TakesOrders, &s.DeliveryFeeCents, &s.TimeZone, &s.PublicPhone, &s.KeyEncrypted, &s.OpeningHours, &s.AwayHours, &s.AwaySince, &s.AIEngine)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, nil
	}
	return s, err
}

// KeyContext ties a business's own Claude key to its company (the old
// anthropicKeyContext): a copy in another company's row can't be read.
func KeyContext(company tenant.CompanyID) string {
	return "assistant-anthropic-key:" + company.String()
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

// readUnavailableToday lists the names of the dishes someone marked "Not
// available today" (a person has none): the AI tells a customer one isn't
// available today, never that it isn't on the menu.
func readUnavailableToday(ctx context.Context, pool *database.Pool, company tenant.CompanyID, kind string) ([]string, error) {
	names := []string{}
	if kind == "personal" {
		return names, nil
	}
	const statement = `
		SELECT name FROM catalog_items
		WHERE company_id = $1 AND unavailable_until > now()
		ORDER BY position, id`
	rows, err := pool.Query(ctx, statement, company.String())
	if err != nil {
		return nil, fmt.Errorf("menu: %w", err)
	}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, rows.Err()
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

// newestCustomerText is the customer's newest message among the lines (""
// when there is none): ansa's order texts are in its language.
func newestCustomerText(lines []Line) string {
	for i := len(lines) - 1; i >= 0; i-- {
		if lines[i].Sender == "customer" {
			return lines[i].Text
		}
	}
	return ""
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
