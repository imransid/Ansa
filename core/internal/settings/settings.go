// Package settings changes how a company's assistant works
// (assistant_settings: one row per company), as the old
// db/assistant-settings.ts. Owners only: every write takes the company row
// lock first, then reads the person's role again (the old asRestaurantOwner),
// and names its columns (never a spread of what a form sent).
package settings

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/hours"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// What a write ended in.
const (
	Saved      = "saved"
	NotAllowed = "not-allowed"
)

// AsOwner runs write inside one transaction while the person is a
// confirmed, active owner: the company row lock first, then the person read
// again (the old asRestaurantOwner). Every owner-only setting write uses it.
func AsOwner(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, write func(tx database.Tx) error) (string, error) {
	outcome := Saved
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role != "owner" {
			outcome = NotAllowed
			return err
		}
		return write(tx)
	})
	return outcome, err
}

// SetStatus: "Pause ansa" ("paused") or "Turn ansa on" ("on").
func SetStatus(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, status string) (string, error) {
	return AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		const upsert = `
			INSERT INTO assistant_settings (company_id, status, updated_by_user_id) VALUES ($1, $2, $3)
			ON CONFLICT (company_id) DO UPDATE SET status = $2, updated_by_user_id = $3, updated_at = now()`
		_, err := tx.Exec(ctx, upsert, company.String(), status, actorUserID)
		return err
	})
}

// SetAnswerWhen: "always" or "when_away" (only when I'm away).
func SetAnswerWhen(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, answerWhen string) (string, error) {
	return AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		const upsert = `
			INSERT INTO assistant_settings (company_id, answer_when, updated_by_user_id) VALUES ($1, $2, $3)
			ON CONFLICT (company_id) DO UPDATE SET answer_when = $2, updated_by_user_id = $3, updated_at = now()`
		_, err := tx.Exec(ctx, upsert, company.String(), answerWhen, actorUserID)
		return err
	})
}

// Assistant is Settings → Assistant's main form.
type Assistant struct {
	Status, ReplyMode, Instructions, HoldingReply string
	AlertByEmail                                  bool
}

// SaveAssistant saves on or paused, the reply mode, the two texts and the email alerts.
func SaveAssistant(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, a Assistant) (string, error) {
	return AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		const upsert = `
			INSERT INTO assistant_settings (company_id, status, reply_mode, instructions, holding_reply, alert_by_email, updated_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (company_id) DO UPDATE SET status = $2, reply_mode = $3, instructions = $4, holding_reply = $5,
				alert_by_email = $6, updated_by_user_id = $7, updated_at = now()`
		_, err := tx.Exec(ctx, upsert, company.String(), a.Status, a.ReplyMode, a.Instructions, a.HoldingReply, a.AlertByEmail, actorUserID)
		return err
	})
}

// KeyChange is what happens to the business's own Claude key: kept,
// removed, or replaced (encrypted, with its last four characters).
type KeyChange struct {
	Remove          bool
	Encrypted, Hint string
}

// SaveEngine saves which AI answers, and the business's own key.
func SaveEngine(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, engine string, key KeyChange) (string, error) {
	return AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		const upsert = `
			INSERT INTO assistant_settings (company_id, ai_engine, updated_by_user_id) VALUES ($1, $2, $3)
			ON CONFLICT (company_id) DO UPDATE SET ai_engine = $2, updated_by_user_id = $3, updated_at = now()`
		if _, err := tx.Exec(ctx, upsert, company.String(), engine, actorUserID); err != nil {
			return err
		}
		switch {
		case key.Encrypted != "":
			_, err := tx.Exec(ctx, `UPDATE assistant_settings SET anthropic_key_encrypted = $2, anthropic_key_hint = $3 WHERE company_id = $1`, company.String(), key.Encrypted, key.Hint)
			return err
		case key.Remove:
			_, err := tx.Exec(ctx, `UPDATE assistant_settings SET anthropic_key_encrypted = NULL, anthropic_key_hint = NULL WHERE company_id = $1`, company.String())
			return err
		}
		return nil
	})
}

// View is Settings → Assistant as saved (defaults when nothing is yet).
type View struct {
	Status            string          `json:"status"`
	ReplyMode         string          `json:"replyMode"`
	Instructions      string          `json:"instructions"`
	HoldingReply      string          `json:"holdingReply"`
	AlertByEmail      bool            `json:"alertByEmail"`
	AnswerWhen        string          `json:"answerWhen"`
	TimeZone          *string         `json:"timeZone"`
	AwayHours         json.RawMessage `json:"awayHours"`
	ReplyGraceMinutes *int            `json:"replyGraceMinutes"`
	Engine            string          `json:"engine"`
	// The last four characters of the business's own key ("" = none). Never the key.
	KeyHint          string          `json:"keyHint"`
	OpeningHours     json.RawMessage `json:"openingHours"`
	TakesOrders      bool            `json:"takesOrders"`
	Delivery         bool            `json:"delivery"`
	DeliveryNote     string          `json:"deliveryNote"`
	DeliveryFeeCents int64           `json:"deliveryFeeCents"`
	Pickup           bool            `json:"pickup"`
	PaymentNote      string          `json:"paymentNote"`
	Currency         *string         `json:"currency"`
	PublicPhone      *string         `json:"publicPhone"`
}

// DefaultHoldingReply is the holding reply until an owner writes their own.
const DefaultHoldingReply = "Thank you for your message. Our team will get back to you as soon as possible."

// Read reads the company's assistant settings.
func Read(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (View, error) {
	v := View{Status: "on", ReplyMode: "automatic", HoldingReply: DefaultHoldingReply, AlertByEmail: true, AnswerWhen: "always", Engine: "api_key",
		AwayHours: json.RawMessage("null"), OpeningHours: json.RawMessage("null"), TakesOrders: true, Pickup: true}
	const statement = `
		SELECT status, reply_mode, instructions, holding_reply, alert_by_email, answer_when, time_zone,
			COALESCE(away_hours::text, 'null'), reply_grace_minutes, ai_engine, COALESCE(anthropic_key_hint, ''),
			COALESCE(opening_hours::text, 'null'), takes_orders, delivery, delivery_note, delivery_fee_cents, pickup, payment_note, currency, public_phone
		FROM assistant_settings WHERE company_id = $1`
	var awayHours, openingHours string
	err := pool.QueryRow(ctx, statement, company.String()).Scan(&v.Status, &v.ReplyMode, &v.Instructions, &v.HoldingReply, &v.AlertByEmail,
		&v.AnswerWhen, &v.TimeZone, &awayHours, &v.ReplyGraceMinutes, &v.Engine, &v.KeyHint,
		&openingHours, &v.TakesOrders, &v.Delivery, &v.DeliveryNote, &v.DeliveryFeeCents, &v.Pickup, &v.PaymentNote, &v.Currency, &v.PublicPhone)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, nil
	}
	// Hours in a shape this code doesn't write are shown as not set.
	v.AwayHours, v.OpeningHours = shapedHours(awayHours), shapedHours(openingHours)
	return v, err
}

// shapedHours keeps stored hours only in the shape this code writes.
func shapedHours(raw string) json.RawMessage {
	if _, ok := hours.Parse([]byte(raw)); !ok {
		return json.RawMessage("null")
	}
	return json.RawMessage(raw)
}
