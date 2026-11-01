package social

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// The tokens of one company's connection, for Renewer.Prepare only (the
// old db/social-connection-tokens.ts): the claim that lets one run at a
// time renew them, and the three ways it writes back, each ending the
// claim. Never for a page.
//
// WHY every write names the access token it replaces: a renewal can take
// seconds, and meanwhile an owner may disconnect or reconnect the account,
// or another run may renew it first. The write then matches nothing, and
// what happened meanwhile stands: a disconnect is never undone by a late
// renewal, and a newer token is never replaced by an older one. (A fresh
// encryption never repeats: each has its own random IV.)

// storedConnection is one connection with its tokens still encrypted.
type storedConnection struct {
	id, platform, externalID, status  string
	lastError                         *string
	isStandIn                         bool
	accessEncrypted, refreshEncrypted *string
	accessExpiresAt, refreshExpiresAt *time.Time
}

// readStoredConnection reads one of the company's connections, nil when
// there is none. The id may be written in capitals: Postgres reads it as
// a uuid and gives back its own spelling.
func readStoredConnection(ctx context.Context, pool *database.Pool, company tenant.CompanyID, connectionID string) (*storedConnection, error) {
	const statement = `
		SELECT id, platform, external_account_id, status, last_error, is_stand_in, access_token_encrypted, refresh_token_encrypted,
			access_expires_at, refresh_expires_at
		FROM social_connections WHERE company_id = $1 AND id = $2`
	var c storedConnection
	err := pool.QueryRow(ctx, statement, company.String(), connectionID).Scan(&c.id, &c.platform, &c.externalID, &c.status, &c.lastError,
		&c.isStandIn, &c.accessEncrypted, &c.refreshEncrypted, &c.accessExpiresAt, &c.refreshExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

// claimRenewal claims the renewal for this run, in one UPDATE, while the
// connection is connected, still holds this token and no other run is
// renewing it: a claim over a minute old belongs to a run that died (a
// renewal is one request of at most 15 seconds). False: another run is,
// or the token changed meanwhile.
func claimRenewal(ctx context.Context, pool *database.Pool, company tenant.CompanyID, connectionID, storedToken string) (bool, error) {
	const claim = `
		UPDATE social_connections SET renewal_started_at = now()
		WHERE company_id = $1 AND id = $2 AND status = 'connected' AND access_token_encrypted = $3
			AND (renewal_started_at IS NULL OR renewal_started_at < now() - interval '60 seconds')`
	tag, err := pool.Exec(ctx, claim, company.String(), connectionID, storedToken)
	return tag.RowsAffected() == 1, err
}

// saveRenewedTokens saves renewed tokens in one UPDATE and clears the last
// problem, while the connection still holds the token they replace.
func saveRenewedTokens(ctx context.Context, pool *database.Pool, company tenant.CompanyID, connectionID, replaced string, renewed storedConnection) (bool, error) {
	const save = `
		UPDATE social_connections SET access_token_encrypted = $4, refresh_token_encrypted = $5, access_expires_at = $6,
			refresh_expires_at = $7, last_error = NULL, renewal_started_at = NULL, updated_at = now()
		WHERE company_id = $1 AND id = $2 AND status = 'connected' AND access_token_encrypted = $3`
	tag, err := pool.Exec(ctx, save, company.String(), connectionID, replaced, renewed.accessEncrypted, renewed.refreshEncrypted,
		renewed.accessExpiresAt, renewed.refreshExpiresAt)
	return tag.RowsAffected() == 1, err
}

// markNeedsReconnect marks a connection as needing a reconnect, saying why,
// while it still holds this token, with a "reconnect_needed" row in the
// activity log (the app's doing). Its tokens stay: a later Disconnect
// still asks the platform to take them back.
func markNeedsReconnect(ctx context.Context, pool *database.Pool, company tenant.CompanyID, connectionID, storedToken, code string) (bool, error) {
	marked := false
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		var err error
		if marked, err = MarkNeedsReconnectWithin(ctx, tx, company, connectionID, storedToken, code); err != nil || !marked {
			return err
		}
		const activity = `
			INSERT INTO cofounder_activity (company_id, actor_user_id, action, draft_id, job_id, connection_id, rule_id, code)
			VALUES ($1, NULL, 'reconnect_needed', NULL, NULL, $2, NULL, $3)`
		_, err = tx.Exec(ctx, activity, company.String(), connectionID, code)
		return err
	})
	return marked, err
}

// noteProblem notes a passing problem (the platform didn't answer a
// renewal) while the connection still holds this token; it stays usable.
func noteProblem(ctx context.Context, pool *database.Pool, company tenant.CompanyID, connectionID, storedToken, code string) (bool, error) {
	const note = `
		UPDATE social_connections SET last_error = $4, renewal_started_at = NULL, updated_at = now()
		WHERE company_id = $1 AND id = $2 AND status = 'connected' AND access_token_encrypted = $3`
	tag, err := pool.Exec(ctx, note, company.String(), connectionID, storedToken, code)
	return tag.RowsAffected() == 1, err
}
