// Package social is the ONLY code in core that decrypts a social account's
// token (the old services/social-tokens.ts): a connection's token is read
// right before a call to its platform and goes only to that platform's
// adapter. Tokens are stored encrypted with the context
// "social-<kind>-token:<company>:<connection>", as the old backend wrote them.
//
// Today it reads Facebook Page tokens (Messenger). Page tokens don't run
// out, so nothing is renewed here; renewing X's and Google's tokens moves
// with the publishing module (phase 4).
package social

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// ErrNotUsable: the connection isn't connected, or its token can't be read
// (a wrong DATA_ENCRYPTION_KEY: the key is the fix, not a reconnect).
var ErrNotUsable = errors.New("social: the connection can't be used now")

// TokenContext names the company, the connection and the token's kind.
func TokenContext(company tenant.CompanyID, connectionID, kind string) string {
	return "social-" + kind + "-token:" + company.String() + ":" + connectionID
}

// PageToken is a connected Facebook Page's token, ready for one call.
func PageToken(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, connectionID string) (string, error) {
	const statement = `
		SELECT id, access_token_encrypted FROM social_connections
		WHERE company_id = $1 AND id = $2 AND platform = 'facebook' AND status = 'connected' AND access_token_encrypted IS NOT NULL`
	var storedID, encrypted string
	err := pool.QueryRow(ctx, statement, company.String(), connectionID).Scan(&storedID, &encrypted)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotUsable
	}
	if err != nil {
		return "", err
	}
	// The stored id, as Postgres gives it back: the token was encrypted for it.
	token, err := box.Decrypt(encrypted, TokenContext(company, storedID, "access"))
	if err != nil || token == "" {
		return "", ErrNotUsable
	}
	return token, nil
}
