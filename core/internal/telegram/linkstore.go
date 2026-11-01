package telegram

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// What linking can end in.
const (
	linkConnected         = "connected"
	linkCannotReply       = "cannot-reply"
	linkElsewhere         = "elsewhere"
	linkCompanyHasAnother = "company-has-another"
	linkNotAllowed        = "not-allowed"
	linkUsed              = "used"
)

// claimedCode is a link code an owner's Start claimed: it names the company.
type claimedCode struct {
	ID, CreatedByUserID string
	CompanyID           tenant.CompanyID
}

// claimLinkCode marks the code with this hash claimed by the Telegram user
// who pressed Start, if unclaimed and unexpired, in the one UPDATE that finds
// it (two Starts with one code: the second matches nothing).
func claimLinkCode(ctx context.Context, pool *database.Pool, codeHash, telegramUserID string) (*claimedCode, error) {
	const statement = `
		-- cross-company: the code's hash names its company (ansa made it); only that row is read.
		UPDATE telegram_link_codes SET claimed_by_telegram_id = $2, claimed_at = now()
		WHERE code_hash = $1 AND claimed_at IS NULL AND expires_at > now()
		RETURNING id, company_id, created_by_user_id`
	return scanCode(pool.QueryRow(ctx, statement, codeHash, telegramUserID))
}

// findClaimedCode is the newest code this Telegram user claimed in the last
// hour that connected nothing yet (the chatbot was added after the Start).
func findClaimedCode(ctx context.Context, pool *database.Pool, telegramUserID string) (*claimedCode, error) {
	const statement = `
		-- cross-company: the Telegram user who claimed a code names its company; only that row is read.
		SELECT id, company_id, created_by_user_id FROM telegram_link_codes
		WHERE claimed_by_telegram_id = $1 AND used_at IS NULL AND claimed_at > now() - make_interval(mins => $2)
		ORDER BY claimed_at DESC LIMIT 1`
	return scanCode(pool.QueryRow(ctx, statement, telegramUserID, linkWaitMinutes))
}

func scanCode(row pgx.Row) (*claimedCode, error) {
	var code claimedCode
	var company string
	err := row.Scan(&code.ID, &company, &code.CreatedByUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	code.CompanyID, err = tenant.FromTrustedSource(company)
	return &code, err
}

// savePendingConnection keeps a chatbot no code named yet, for an hour
// (Telegram's ids and the account's name only; it belongs to no company).
func savePendingConnection(ctx context.Context, pool *database.Pool, facts accountFacts) error {
	const statement = `
		INSERT INTO telegram_pending_connections (external_id, account_telegram_id, account_chat_id, display_name, can_reply, received_at)
		VALUES ($1, $2, $3, $4, $5, now())
		ON CONFLICT (external_id) DO UPDATE SET account_telegram_id = $2, account_chat_id = $3, display_name = $4, can_reply = $5, received_at = now()`
	_, err := pool.Exec(ctx, statement, facts.ExternalID, facts.AccountTelegramID, facts.AccountChatID, facts.DisplayName, facts.CanReply)
	return err
}

// findPendingConnection is the newest chatbot this Telegram user added in the last hour.
func findPendingConnection(ctx context.Context, pool *database.Pool, telegramUserID string) (*accountFacts, error) {
	const statement = `
		SELECT external_id, account_telegram_id, account_chat_id, display_name, can_reply FROM telegram_pending_connections
		WHERE account_telegram_id = $1 AND received_at > now() - make_interval(mins => $2)
		ORDER BY received_at DESC LIMIT 1`
	var f accountFacts
	err := pool.QueryRow(ctx, statement, telegramUserID, linkWaitMinutes).Scan(&f.ExternalID, &f.AccountTelegramID, &f.AccountChatID, &f.DisplayName, &f.CanReply)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &f, err
}

func deletePendingConnection(ctx context.Context, pool *database.Pool, externalID string) error {
	_, err := pool.Exec(ctx, `DELETE FROM telegram_pending_connections WHERE external_id = $1`, externalID)
	return err
}

// updateLinkedAccount: Telegram says an account tied to a company changed
// (the bot removed or added back, its permission to reply, its name).
// Reports whether a company has that account.
func updateLinkedAccount(ctx context.Context, pool *database.Pool, facts accountFacts, enabled bool) (bool, error) {
	status := "connected"
	switch {
	case !enabled:
		status = "removed_in_telegram"
	case !facts.CanReply:
		status = "cannot_reply"
	}
	const statement = `
		-- cross-company: Telegram's connection id names the one company that has it (a code tied it).
		UPDATE channel_connections SET status = $2, display_name = $3, account_chat_id = $4, updated_at = now()
		WHERE channel = 'telegram' AND external_id = $1 AND status <> 'disconnected'
		RETURNING company_id`
	var company string
	err := pool.QueryRow(ctx, statement, facts.ExternalID, status, facts.DisplayName, facts.AccountChatID).Scan(&company)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}
