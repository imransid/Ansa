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
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// What a write ended in.
const (
	Saved      = "saved"
	NotAllowed = "not-allowed"
)

// asOwner runs write inside one transaction while the person is a
// confirmed, active owner.
func asOwner(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, write func(tx database.Tx) error) (string, error) {
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
	return asOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		const upsert = `
			INSERT INTO assistant_settings (company_id, status, updated_by_user_id) VALUES ($1, $2, $3)
			ON CONFLICT (company_id) DO UPDATE SET status = $2, updated_by_user_id = $3, updated_at = now()`
		_, err := tx.Exec(ctx, upsert, company.String(), status, actorUserID)
		return err
	})
}

// SetAway: "I'm away" (since now) or "I'm back".
func SetAway(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string, away bool) (string, error) {
	return asOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		const upsert = `
			INSERT INTO assistant_settings (company_id, away_since, updated_by_user_id) VALUES ($1, CASE WHEN $2 THEN now() END, $3)
			ON CONFLICT (company_id) DO UPDATE SET away_since = CASE WHEN $2 THEN now() END, updated_by_user_id = $3, updated_at = now()`
		_, err := tx.Exec(ctx, upsert, company.String(), away, actorUserID)
		return err
	})
}

// SetAnswerWhen: "always" or "when_away" (only when I'm away).
func SetAnswerWhen(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, answerWhen string) (string, error) {
	return asOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
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
	return asOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
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
	return asOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
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

// SaveAway saves a person's weekly away hours (as jsonb, in the shape the
// old backend writes), their time zone, and how long ansa waits for them to
// answer first (nil: it doesn't step in while they're available).
func SaveAway(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, timeZone string, awayHours []byte, graceMinutes *int) (string, error) {
	return asOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		const upsert = `
			INSERT INTO assistant_settings (company_id, time_zone, away_hours, reply_grace_minutes, updated_by_user_id)
			VALUES ($1, $2, $3::jsonb, $4, $5)
			ON CONFLICT (company_id) DO UPDATE SET time_zone = $2, away_hours = $3::jsonb, reply_grace_minutes = $4,
				updated_by_user_id = $5, updated_at = now()`
		_, err := tx.Exec(ctx, upsert, company.String(), timeZone, string(awayHours), graceMinutes, actorUserID)
		return err
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
	KeyHint string `json:"keyHint"`
}

// DefaultHoldingReply is the holding reply until an owner writes their own.
const DefaultHoldingReply = "Thank you for your message. Our team will get back to you as soon as possible."

// Read reads the company's assistant settings.
func Read(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (View, error) {
	v := View{Status: "on", ReplyMode: "automatic", HoldingReply: DefaultHoldingReply, AlertByEmail: true, AnswerWhen: "always", Engine: "api_key", AwayHours: json.RawMessage("null")}
	const statement = `
		SELECT status, reply_mode, instructions, holding_reply, alert_by_email, answer_when, time_zone,
			COALESCE(away_hours::text, 'null'), reply_grace_minutes, ai_engine, COALESCE(anthropic_key_hint, '')
		FROM assistant_settings WHERE company_id = $1`
	var awayHours string
	err := pool.QueryRow(ctx, statement, company.String()).Scan(&v.Status, &v.ReplyMode, &v.Instructions, &v.HoldingReply, &v.AlertByEmail,
		&v.AnswerWhen, &v.TimeZone, &awayHours, &v.ReplyGraceMinutes, &v.Engine, &v.KeyHint)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, nil
	}
	v.AwayHours = json.RawMessage(awayHours)
	return v, err
}
