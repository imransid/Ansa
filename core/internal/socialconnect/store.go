package socialconnect

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/publishing"
	"ansa/core/internal/secure"
	"ansa/core/internal/social"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// errChanged: an account's row was taken under another id at the same
// moment (a second connect): saving again uses the id there now.
var errChanged = errors.New("socialconnect: changed meanwhile")

// saveAccounts saves the accounts a login authorized (or a stand-in), each
// token encrypted for its own connection (company, connection id, kind).
// An account connected before keeps its row and id and gets the new
// tokens, connected again by this owner; a "connected" activity row each.
// "connected" or "not-allowed".
func saveAccounts(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, actorUserID, platform string, accounts []Account) (string, error) {
	// WHY a second try: a connect of the same account at the same moment can
	// take a new row under another id; the tokens are encrypted again for it.
	for attempt := 0; attempt < 2; attempt++ {
		outcome, err := saveAccountsOnce(ctx, pool, box, company, actorUserID, platform, accounts)
		if !errors.Is(err, errChanged) {
			return outcome, err
		}
	}
	return "", errChanged
}

func saveAccountsOnce(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, actorUserID, platform string, accounts []Account) (string, error) {
	outcome := "connected"
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role != "owner" {
			outcome = "not-allowed"
			return err
		}
		for _, account := range accounts {
			id, err := saveOneWithin(ctx, tx, box, company, actorUserID, platform, account)
			if err != nil {
				return err
			}
			entry := publishing.Activity{Action: "connected", ActorUserID: actorUserID, ConnectionID: id}
			if err := publishing.RecordActivityWithin(ctx, tx, company, entry); err != nil {
				return err
			}
		}
		return nil
	})
	return outcome, err
}

// saveOneWithin writes one account (every column named), its tokens
// encrypted for the row's id. A renewal of the old tokens running now
// saves nothing over these (its claim ends here). errChanged: the row has
// another id now.
func saveOneWithin(ctx context.Context, tx database.Tx, box *secure.Box, company tenant.CompanyID, actorUserID, platform string, account Account) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `SELECT id FROM social_connections WHERE company_id = $1 AND platform = $2 AND external_account_id = $3`,
		company.String(), platform, account.ExternalID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		id, err = conversations.NewID()
	}
	if err != nil {
		return "", err
	}
	access, err := box.Encrypt(account.AccessToken, social.TokenContext(company, id, "access"))
	if err != nil {
		return "", err
	}
	var refresh *string
	var refreshExpiresAt *time.Time
	if account.RefreshToken != "" {
		encrypted, err := box.Encrypt(account.RefreshToken, social.TokenContext(company, id, "refresh"))
		if err != nil {
			return "", err
		}
		// An end only for a refresh token that is kept.
		refresh, refreshExpiresAt = &encrypted, account.RefreshExpiresAt
	}
	const upsert = `
		INSERT INTO social_connections (id, company_id, platform, external_account_id, display_name, account_kind, scopes,
			access_token_encrypted, refresh_token_encrypted, access_expires_at, refresh_expires_at, status, last_error,
			renewal_started_at, connected_by_user_id, connected_at, disconnected_at, is_stand_in)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'connected', NULL, NULL, $12, now(), NULL, $4 = 'dev:stand-in')
		ON CONFLICT (company_id, platform, external_account_id) DO UPDATE SET
			display_name = EXCLUDED.display_name, account_kind = EXCLUDED.account_kind, scopes = EXCLUDED.scopes,
			access_token_encrypted = EXCLUDED.access_token_encrypted, refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
			access_expires_at = EXCLUDED.access_expires_at, refresh_expires_at = EXCLUDED.refresh_expires_at, status = 'connected',
			last_error = NULL, renewal_started_at = NULL, connected_by_user_id = EXCLUDED.connected_by_user_id, connected_at = now(),
			disconnected_at = NULL, updated_at = now()
		WHERE social_connections.company_id = $2 AND social_connections.id = $1
		RETURNING id`
	scopes := account.Scopes
	if scopes == nil {
		scopes = []string{}
	}
	var saved string
	err = tx.QueryRow(ctx, upsert, id, company.String(), platform, account.ExternalID, account.DisplayName, account.Kind, scopes,
		access, refresh, account.AccessExpiresAt, refreshExpiresAt, actorUserID).Scan(&saved)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", errChanged
	}
	return saved, err
}

// Disconnect disconnects one of the company's accounts (owners): in ONE
// transaction its tokens are removed and the row kept as "disconnected",
// with a "disconnected" activity row. It returns what was taken off (the
// tokens still encrypted) for social.RevokeRemoved after the answer: X
// and Google take ansa's access back on request; LinkedIn and Facebook
// offer no revoke with what ansa keeps (the owner removes ansa there).
// "disconnected", "already-disconnected", "not-found" or "not-allowed".
func Disconnect(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, connectionID string) (string, *social.Removed, error) {
	outcome := "disconnected"
	var removed social.Removed
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role != "owner" {
			outcome = "not-allowed"
			return err
		}
		const current = `
			SELECT id, status, platform, external_account_id, is_stand_in, coalesce(access_token_encrypted, ''), coalesce(refresh_token_encrypted, '')
			FROM social_connections WHERE company_id = $1 AND id::text = $2 FOR UPDATE`
		var status string
		err = tx.QueryRow(ctx, current, company.String(), connectionID).Scan(&removed.ConnectionID, &status, &removed.Platform, &removed.ExternalID,
			&removed.IsStandIn, &removed.AccessEncrypted, &removed.RefreshEncrypted)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			outcome = "not-found"
			return nil
		case err != nil:
			return err
		case status == "disconnected":
			outcome = "already-disconnected"
			return nil
		}
		const disconnect = `
			UPDATE social_connections SET status = 'disconnected', access_token_encrypted = NULL, refresh_token_encrypted = NULL,
				access_expires_at = NULL, refresh_expires_at = NULL, last_error = NULL, renewal_started_at = NULL,
				disconnected_at = now(), updated_at = now()
			WHERE company_id = $1 AND id::text = $2 AND status <> 'disconnected'`
		if _, err := tx.Exec(ctx, disconnect, company.String(), connectionID); err != nil {
			return err
		}
		return publishing.RecordActivityWithin(ctx, tx, company, publishing.Activity{Action: "disconnected", ActorUserID: actorUserID, ConnectionID: connectionID})
	})
	if err != nil || outcome != "disconnected" {
		return outcome, nil, err
	}
	return outcome, &removed, nil
}
