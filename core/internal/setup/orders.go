package setup

import (
	"context"
	"regexp"
	"strings"

	"golang.org/x/text/currency"

	"ansa/core/internal/database"
	"ansa/core/internal/money"
	"ansa/core/internal/plaintext"
	"ansa/core/internal/settings"
	"ansa/core/internal/tenant"
)

// Orders is step 4: orders, delivery and pickup, payment, the currency.
type Orders struct {
	TakesOrders  bool   `json:"takesOrders"`
	Delivery     bool   `json:"delivery"`
	DeliveryNote string `json:"deliveryNote"`
	// Typed as a price in the currency ("2.50"; empty = free).
	DeliveryFee      string `json:"deliveryFee"`
	DeliveryFeeCents int64  `json:"-"`
	Pickup           bool   `json:"pickup"`
	PaymentNote      string `json:"paymentNote"`
	Currency         string `json:"currency"`
}

var currencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)

// Check cleans the section and says what is wrong.
func (o *Orders) Check() Fields {
	fields := Fields{}
	// WHY: with neither, ansa's question promised a pickup the business never
	// offered, and the customer was asked it again and again.
	if o.TakesOrders && !o.Delivery && !o.Pickup {
		fields["form"] = "Choose delivery, pickup or both to take orders."
	}
	var problem string
	if o.DeliveryNote, problem = plaintext.Note(o.DeliveryNote, 500); problem != "" {
		fields["deliveryNote"] = problem
	}
	if o.PaymentNote, problem = plaintext.Note(o.PaymentNote, 500); problem != "" {
		fields["paymentNote"] = problem
	}
	if _, err := currency.ParseISO(o.Currency); !currencyPattern.MatchString(o.Currency) || err != nil {
		fields["currency"] = "Choose a currency from the list."
		return fields
	}
	fee := strings.TrimSpace(o.DeliveryFee)
	switch {
	case fee == "":
		o.DeliveryFeeCents = 0
	case len(fee) > 30 || money.ParsePrice(fee, o.Currency) < 0:
		fields["deliveryFee"] = "Write the fee as a price, like 2.50, or leave it empty."
	default:
		o.DeliveryFeeCents = money.ParsePrice(fee, o.Currency)
	}
	return fields
}

// SaveOrders saves step 4.
func SaveOrders(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, o Orders, reached int) (string, error) {
	return settings.AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		const upsert = `
			INSERT INTO assistant_settings (company_id, takes_orders, delivery, delivery_note, delivery_fee_cents, pickup, payment_note, currency, updated_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			ON CONFLICT (company_id) DO UPDATE SET takes_orders = $2, delivery = $3, delivery_note = $4, delivery_fee_cents = $5,
				pickup = $6, payment_note = $7, currency = $8, updated_by_user_id = $9, updated_at = now()`
		if _, err := tx.Exec(ctx, upsert, company.String(), o.TakesOrders, o.Delivery, o.DeliveryNote, o.DeliveryFeeCents, o.Pickup, o.PaymentNote, o.Currency, actorUserID); err != nil {
			return err
		}
		return recordProgressWithin(ctx, tx, company, reached)
	})
}
