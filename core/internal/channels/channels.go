// Package channels is Settings → Connections (the old
// services/telegram-connect.ts and the Connections page's reads): where
// people reach the company. Owners connect Telegram through a one-time link
// to ansa's bot and disconnect it; everyone reads it. Facebook Pages come
// from the social connection (their messaging permission shown), the
// WhatsApp number from core/internal/whatsapp's connection; the email
// forwarding address and phone lines are read-only.
package channels

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/settings"
	"ansa/core/internal/telegram"
	"ansa/core/internal/tenant"
)

// Page is what Settings → Connections shows.
type Page struct {
	Telegram          *Telegram      `json:"telegram"`
	WhatsApp          *WhatsApp      `json:"whatsapp"`
	FacebookPages     []FacebookPage `json:"facebookPages"`
	ForwardingAddress string         `json:"forwardingAddress"`
	LastEmailAt       *time.Time     `json:"lastEmailAt"`
	PhoneLines        []PhoneLine    `json:"phoneLines"`
}

// Telegram is the company's Telegram account (nil: none, or disconnected).
type Telegram struct {
	DisplayName string    `json:"displayName"`
	Status      string    `json:"status"`
	IsStandIn   bool      `json:"isStandIn"`
	ConnectedAt time.Time `json:"connectedAt"`
}

// FacebookPage is a connected Page and whether its messages come to ansa.
type FacebookPage struct {
	// The connection's id (Disconnect names it).
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	Status      string `json:"status"`
	CanMessage  bool   `json:"canMessage"`
	IsStandIn   bool   `json:"isStandIn"`
}

// PhoneLine is one of ansa's numbers linked to the company, and its last call.
type PhoneLine struct {
	ID         string     `json:"id"`
	LastCallAt *time.Time `json:"lastCallAt"`
}

// Read reads the page. forwardingDomain: INBOUND_EMAIL_DOMAIN.
func Read(ctx context.Context, pool *database.Pool, company tenant.CompanyID, forwardingDomain string) (Page, error) {
	page := Page{FacebookPages: []FacebookPage{}, PhoneLines: []PhoneLine{}}
	var t Telegram
	err := pool.QueryRow(ctx, `
		SELECT display_name, status, is_stand_in, connected_at FROM channel_connections
		WHERE company_id = $1 AND channel = 'telegram' AND status <> 'disconnected'
		ORDER BY connected_at DESC LIMIT 1`, company.String()).Scan(&t.DisplayName, &t.Status, &t.IsStandIn, &t.ConnectedAt)
	if err == nil {
		page.Telegram = &t
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return page, err
	}
	var token string
	if err := pool.QueryRow(ctx, `SELECT inbound_token FROM companies WHERE id = $1`, company.String()).Scan(&token); err != nil {
		return page, err
	}
	page.ForwardingAddress = "c-" + token + "@" + forwardingDomain
	if err := pool.QueryRow(ctx, `SELECT max(received_at) FROM inbound_emails WHERE company_id = $1`, company.String()).Scan(&page.LastEmailAt); err != nil {
		return page, err
	}
	if page.FacebookPages, err = facebookPages(ctx, pool, company); err != nil {
		return page, err
	}
	if page.WhatsApp, err = whatsappNumber(ctx, pool, company); err != nil {
		return page, err
	}
	page.PhoneLines, err = phoneLines(ctx, pool, company)
	return page, err
}

func facebookPages(ctx context.Context, pool *database.Pool, company tenant.CompanyID) ([]FacebookPage, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, display_name, status, is_stand_in OR ('pages_messaging' = ANY(scopes) AND 'pages_manage_metadata' = ANY(scopes)), is_stand_in
		FROM social_connections
		WHERE company_id = $1 AND platform = 'facebook' AND status <> 'disconnected' ORDER BY display_name`, company.String())
	if err != nil {
		return nil, err
	}
	pages := []FacebookPage{}
	for rows.Next() {
		var p FacebookPage
		if err := rows.Scan(&p.ID, &p.DisplayName, &p.Status, &p.CanMessage, &p.IsStandIn); err != nil {
			return nil, err
		}
		pages = append(pages, p)
	}
	return pages, rows.Err()
}

// phoneLines: one small read per number (a company has only a few), each
// reading only that number's newest call.
func phoneLines(ctx context.Context, pool *database.Pool, company tenant.CompanyID) ([]PhoneLine, error) {
	rows, err := pool.Query(ctx, `SELECT id, vapi_phone_number_id FROM phone_lines WHERE company_id = $1 ORDER BY created_at, id`, company.String())
	if err != nil {
		return nil, err
	}
	type line struct{ id, vapiID string }
	var found []line
	for rows.Next() {
		var l line
		if err := rows.Scan(&l.id, &l.vapiID); err != nil {
			return nil, err
		}
		found = append(found, l)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	lines := []PhoneLine{}
	for _, l := range found {
		p := PhoneLine{ID: l.vapiID}
		err := pool.QueryRow(ctx, `SELECT created_at FROM calls WHERE company_id = $1 AND phone_line_id = $2 ORDER BY created_at DESC LIMIT 1`, company.String(), l.id).Scan(&p.LastCallAt)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		lines = append(lines, p)
	}
	return lines, nil
}

// TelegramLink makes a one-time code (32 random bytes; only its SHA-256 is
// stored, for 10 minutes) and returns it for the link to ansa's bot.
func TelegramLink(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string) (string, string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	code := base64.RawURLEncoding.EncodeToString(raw)
	outcome, err := settings.AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		const insert = `
			INSERT INTO telegram_link_codes (company_id, created_by_user_id, code_hash, expires_at)
			VALUES ($1, $2, $3, now() + interval '10 minutes')`
		_, err := tx.Exec(ctx, insert, company.String(), actorUserID, telegram.HashLinkCode(code))
		return err
	})
	return code, outcome, err
}

// AlreadyConnected: a stand-in can't replace a connected account.
const AlreadyConnected = "exists"

// ConnectStandIn connects a stand-in Telegram account (development without
// ansa's bot: its customers come from the simulator).
func ConnectStandIn(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, externalID string) (string, error) {
	exists := false
	outcome, err := settings.AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		var live bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM channel_connections WHERE company_id = $1 AND channel = 'telegram' AND status <> 'disconnected')`, company.String()).Scan(&live); err != nil || live {
			exists = live
			return err
		}
		const insert = `
			INSERT INTO channel_connections (company_id, channel, external_id, account_telegram_id, account_chat_id, display_name, status, is_stand_in, connected_by_user_id)
			VALUES ($1, 'telegram', $2, '1', '1', 'Stand-in Telegram account', 'connected', true, $3)`
		_, err := tx.Exec(ctx, insert, company.String(), externalID, actorUserID)
		return err
	})
	if err == nil && outcome == settings.Saved && exists {
		return AlreadyConnected, nil
	}
	return outcome, err
}

// DisconnectTelegram stops the account's messages and replies in ansa
// (the row stays, as history). Connecting again needs a new link.
func DisconnectTelegram(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID string) (string, error) {
	return settings.AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		_, err := tx.Exec(ctx, `UPDATE channel_connections SET status = 'disconnected', disconnected_at = now(), updated_at = now()
			WHERE company_id = $1 AND channel = 'telegram' AND status <> 'disconnected'`, company.String())
		return err
	})
}
