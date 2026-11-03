package commands

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// What the development tools read of one company, each company-scoped.

// StandInTelegramConnection is the business connection id of the company's
// development stand-in Telegram account ("" = none connected).
func StandInTelegramConnection(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (string, error) {
	const statement = `
		SELECT external_id FROM channel_connections
		WHERE company_id = $1 AND channel = 'telegram' AND is_stand_in AND status <> 'disconnected'
		LIMIT 1`
	return oneText(pool.QueryRow(ctx, statement, company.String()))
}

// StandInTelegramAccountUser is the Telegram user id of the company's
// development stand-in Telegram account itself ("" = none connected): what
// the business writes in its own Telegram app comes from it.
func StandInTelegramAccountUser(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (string, error) {
	const statement = `
		SELECT account_telegram_id FROM channel_connections
		WHERE company_id = $1 AND channel = 'telegram' AND is_stand_in AND status <> 'disconnected'
		LIMIT 1`
	return oneText(pool.QueryRow(ctx, statement, company.String()))
}

// StandInFacebookPage is the Page id of the company's connected development
// stand-in Facebook Page ("" = none).
func StandInFacebookPage(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (string, error) {
	const statement = `
		SELECT external_account_id FROM social_connections
		WHERE company_id = $1 AND platform = 'facebook' AND is_stand_in AND status = 'connected'
		LIMIT 1`
	return oneText(pool.QueryRow(ctx, statement, company.String()))
}

// StandInWhatsAppNumber is the phone number id of the company's connected
// development stand-in WhatsApp number ("" = none).
func StandInWhatsAppNumber(ctx context.Context, pool *database.Pool, company tenant.CompanyID) (string, error) {
	const statement = `
		SELECT phone_number_id FROM whatsapp_numbers
		WHERE company_id = $1 AND is_stand_in AND status = 'connected'`
	return oneText(pool.QueryRow(ctx, statement, company.String()))
}

// CallOfVapiID is the id of the company's saved call with Vapi's call id
// ("" = none saved).
func CallOfVapiID(ctx context.Context, pool *database.Pool, company tenant.CompanyID, vapiCallID string) (string, error) {
	return oneText(pool.QueryRow(ctx, `SELECT id FROM calls WHERE company_id = $1 AND vapi_call_id = $2`, company.String(), vapiCallID))
}

// oneText is the row's one text column, or "" when there is no row.
func oneText(row pgx.Row) (string, error) {
	var text string
	err := row.Scan(&text)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return text, err
}
