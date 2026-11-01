package telegram

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
)

// linkAccount ties a Telegram account to the company of the code its owner
// claimed, in ONE transaction: the company row lock first, the code's maker
// read again (still a confirmed, active owner), then the code (still unused,
// locked). Refused when the account is tied to another company, or the
// company has another one (one removed in Telegram is replaced).
func linkAccount(ctx context.Context, pool *database.Pool, code claimedCode, facts accountFacts) (string, error) {
	outcome := linkUsed
	company := code.CompanyID.String()
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT id FROM companies WHERE id = $1 FOR NO KEY UPDATE`, company); err != nil {
			return err
		}
		var role string
		err := tx.QueryRow(ctx, `SELECT role FROM users WHERE company_id = $1 AND id = $2 AND email_verified = true AND deactivated_at IS NULL FOR SHARE`, company, code.CreatedByUserID).Scan(&role)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && role != "owner") {
			outcome = linkNotAllowed
			return nil
		}
		if err != nil {
			return err
		}
		var open string
		err = tx.QueryRow(ctx, `SELECT id FROM telegram_link_codes WHERE company_id = $1 AND id = $2 AND used_at IS NULL FOR UPDATE`, company, code.ID).Scan(&open)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if outcome, err = tieAccountWithin(ctx, tx, code, facts); err != nil || (outcome != linkConnected && outcome != linkCannotReply) {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE telegram_link_codes SET used_at = now() WHERE company_id = $1 AND id = $2`, company, code.ID); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `DELETE FROM telegram_pending_connections WHERE external_id = $1`, facts.ExternalID)
		return err
	})
	return outcome, err
}

// tieAccountWithin writes the connection row: the account's own when this
// company has it already, else a new one.
func tieAccountWithin(ctx context.Context, tx database.Tx, code claimedCode, facts accountFacts) (string, error) {
	company := code.CompanyID.String()
	status, outcome := "connected", linkConnected
	if !facts.CanReply {
		status, outcome = "cannot_reply", linkCannotReply
	}
	const tiedStatement = `
		-- cross-company: which company the account is tied to now; only that company's id is read.
		SELECT id, company_id FROM channel_connections
		WHERE channel = 'telegram' AND external_id = $1 AND status <> 'disconnected'`
	var tiedID, tiedCompany string
	err := tx.QueryRow(ctx, tiedStatement, facts.ExternalID).Scan(&tiedID, &tiedCompany)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	if tiedID != "" && tiedCompany != company {
		return linkElsewhere, nil
	}
	if tiedID != "" {
		const update = `
			UPDATE channel_connections SET account_telegram_id = $3, account_chat_id = $4, display_name = $5, status = $6,
				connected_by_user_id = $7, connected_at = now(), updated_at = now()
			WHERE company_id = $1 AND id = $2`
		_, err := tx.Exec(ctx, update, company, tiedID, facts.AccountTelegramID, facts.AccountChatID, facts.DisplayName, status, code.CreatedByUserID)
		return outcome, err
	}
	var otherID, otherStatus string
	err = tx.QueryRow(ctx, `SELECT id, status FROM channel_connections WHERE company_id = $1 AND channel = 'telegram' AND status <> 'disconnected'`, company).Scan(&otherID, &otherStatus)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	if otherID != "" && otherStatus != "removed_in_telegram" {
		return linkCompanyHasAnother, nil
	}
	if otherID != "" {
		if _, err := tx.Exec(ctx, `UPDATE channel_connections SET status = 'disconnected', disconnected_at = now(), updated_at = now() WHERE company_id = $1 AND id = $2`, company, otherID); err != nil {
			return "", err
		}
	}
	const insert = `
		INSERT INTO channel_connections (company_id, channel, external_id, account_telegram_id, account_chat_id, display_name, status, connected_by_user_id, connected_at, updated_at)
		VALUES ($1, 'telegram', $2, $3, $4, $5, $6, $7, now(), now())`
	_, err = tx.Exec(ctx, insert, company, facts.ExternalID, facts.AccountTelegramID, facts.AccountChatID, facts.DisplayName, status, code.CreatedByUserID)
	return outcome, err
}
