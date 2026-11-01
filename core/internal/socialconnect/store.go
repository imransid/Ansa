package socialconnect

import (
	"context"
	"errors"

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

// createAttempt saves one attempt while actorUserID is an active owner (the
// role read again FOR SHARE). It works for 10 minutes by the database's clock.
func createAttempt(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, stateHash string) (bool, error) {
	saved := false
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role != "owner" {
			return err
		}
		id, err := conversations.NewID()
		if err != nil {
			return err
		}
		const insert = `
			INSERT INTO oauth_states (id, company_id, user_id, platform, state_hash, expires_at)
			VALUES ($1, $2, $3, 'facebook', $4, now() + interval '10 minutes')`
		if _, err := tx.Exec(ctx, insert, id, company.String(), actorUserID, stateHash); err != nil {
			return err
		}
		saved = true
		return nil
	})
	return saved, err
}

// claimAttempt marks the attempt with this state's hash used, if it is this
// person's, in this company, for Facebook, unused and unexpired, all in the
// ONE UPDATE that finds it: of two returns with the same state at the same
// moment, the second waits for the first's row lock, then matches nothing.
func claimAttempt(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, stateHash string) (bool, error) {
	const claim = `
		UPDATE oauth_states SET used_at = now()
		WHERE company_id = $1 AND user_id = $2 AND platform = 'facebook' AND state_hash = $3 AND used_at IS NULL AND expires_at > now()`
	tag, err := pool.Exec(ctx, claim, company.String(), actorUserID, stateHash)
	return tag.RowsAffected() == 1, err
}

// saveAccounts saves the Pages a login authorized, each token encrypted
// for its own connection (company, connection id, "access"). A Page
// connected before keeps its row and id and gets the new token; a "connected"
// activity row each. "connected" or "not-allowed".
func saveAccounts(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, actorUserID string, accounts []Account) (string, error) {
	// WHY a second try: a connect of the same Page at the same moment can
	// take a new row under another id; the token is encrypted again for it.
	for attempt := 0; attempt < 2; attempt++ {
		outcome, err := saveAccountsOnce(ctx, pool, box, company, actorUserID, accounts)
		if !errors.Is(err, errChanged) {
			return outcome, err
		}
	}
	return "", errChanged
}

func saveAccountsOnce(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, actorUserID string, accounts []Account) (string, error) {
	outcome := "connected"
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role != "owner" {
			outcome = "not-allowed"
			return err
		}
		for _, account := range accounts {
			id, err := saveOneWithin(ctx, tx, box, company, actorUserID, account)
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

// saveOneWithin writes one account (every column named), its token
// encrypted for the row's id. errChanged: the row has another id now.
func saveOneWithin(ctx context.Context, tx database.Tx, box *secure.Box, company tenant.CompanyID, actorUserID string, account Account) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `SELECT id FROM social_connections WHERE company_id = $1 AND platform = 'facebook' AND external_account_id = $2`, company.String(), account.ExternalID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		id, err = conversations.NewID()
	}
	if err != nil {
		return "", err
	}
	token, err := box.Encrypt(account.AccessToken, social.TokenContext(company, id, "access"))
	if err != nil {
		return "", err
	}
	const upsert = `
		INSERT INTO social_connections (id, company_id, platform, external_account_id, display_name, account_kind, scopes,
			access_token_encrypted, refresh_token_encrypted, access_expires_at, refresh_expires_at, status, last_error,
			renewal_started_at, connected_by_user_id, connected_at, disconnected_at, is_stand_in)
		VALUES ($1, $2, 'facebook', $3, $4, $5, $6, $7, NULL, NULL, NULL, 'connected', NULL, NULL, $8, now(), NULL, $3 = 'dev:stand-in')
		ON CONFLICT (company_id, platform, external_account_id) DO UPDATE SET
			display_name = EXCLUDED.display_name, account_kind = EXCLUDED.account_kind, scopes = EXCLUDED.scopes,
			access_token_encrypted = EXCLUDED.access_token_encrypted, refresh_token_encrypted = NULL, access_expires_at = NULL,
			refresh_expires_at = NULL, status = 'connected', last_error = NULL, renewal_started_at = NULL,
			connected_by_user_id = EXCLUDED.connected_by_user_id, connected_at = now(), disconnected_at = NULL, updated_at = now()
		WHERE social_connections.company_id = $2 AND social_connections.id = $1
		RETURNING id`
	var saved string
	err = tx.QueryRow(ctx, upsert, id, company.String(), account.ExternalID, account.DisplayName, account.Kind, account.Scopes, token, actorUserID).Scan(&saved)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", errChanged
	}
	return saved, err
}

// Disconnect disconnects one of the company's Facebook Pages (owners): in
// ONE transaction its token is removed and the row kept as "disconnected",
// with a "disconnected" activity row. Facebook offers no revoke with what
// ansa keeps: the owner removes ansa under Facebook's Business
// Integrations. "disconnected", "already-disconnected", "not-found" or
// "not-allowed". Other platforms' accounts are disconnected by the old
// backend until their publishing moves (X and Google revoke on request).
func Disconnect(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, connectionID string) (string, error) {
	outcome := "disconnected"
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role != "owner" {
			outcome = "not-allowed"
			return err
		}
		var status string
		err = tx.QueryRow(ctx, `SELECT status FROM social_connections WHERE company_id = $1 AND id::text = $2 AND platform = 'facebook' FOR UPDATE`, company.String(), connectionID).Scan(&status)
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
	return outcome, err
}
