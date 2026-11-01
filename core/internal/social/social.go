// Package social is the ONLY code in core that decrypts a social account's
// token (the old services/social-tokens.ts): a connection's token is read
// right before a call to its platform and goes only to that platform's
// adapter. Tokens are stored encrypted with the context
// "social-<kind>-token:<company>:<connection>", as the old backend wrote them.
//
// Today it reads Facebook Page tokens (Messenger and posts). Page tokens
// don't run out, so nothing is renewed here; renewing X's and Google's
// tokens moves with their publishing.
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

// ErrNotConnected: the account was disconnected (or isn't the company's).
var ErrNotConnected = errors.New("social: the account is not connected")

// ErrNeedsReconnect: the platform no longer accepts ansa's permission for
// the account: an owner connects it again.
var ErrNeedsReconnect = errors.New("social: the account needs a reconnect")

// Page is a connected Facebook Page ready for one post.
type Page struct {
	// Facebook's Page id ("dev:stand-in" for the development stand-in).
	ExternalID string
	Token      string
	// The token as stored: a refusal marks the account only while it still
	// holds this one (a reconnect meanwhile stands).
	StoredToken string
	IsStandIn   bool
}

// PageForPosting reads one connected Facebook Page of one company for a
// post: ErrNeedsReconnect or ErrNotConnected when it isn't connected now,
// ErrNotUsable when its token can't be read.
func PageForPosting(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, connectionID string) (*Page, error) {
	const statement = `
		SELECT id, external_account_id, status, is_stand_in, access_token_encrypted FROM social_connections
		WHERE company_id = $1 AND id = $2 AND platform = 'facebook'`
	var storedID, status string
	var stored *string
	var page Page
	err := pool.QueryRow(ctx, statement, company.String(), connectionID).Scan(&storedID, &page.ExternalID, &status, &page.IsStandIn, &stored)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return nil, ErrNotConnected
	case err != nil:
		return nil, err
	case status == "needs_reauth":
		return nil, ErrNeedsReconnect
	case status != "connected" || stored == nil:
		return nil, ErrNotConnected
	}
	token, err := box.Decrypt(*stored, TokenContext(company, storedID, "access"))
	if err != nil || token == "" {
		return nil, ErrNotUsable
	}
	page.Token, page.StoredToken = token, *stored
	return &page, nil
}

// MarkNeedsReconnectWithin marks a connection as needing a reconnect (the
// platform refused its token), only while it still holds storedToken. True
// when it did; the caller records it in the activity log.
func MarkNeedsReconnectWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, connectionID, storedToken, code string) (bool, error) {
	const statement = `
		UPDATE social_connections SET status = 'needs_reauth', last_error = $4, renewal_started_at = NULL, updated_at = now()
		WHERE company_id = $1 AND id = $2 AND status = 'connected' AND access_token_encrypted = $3`
	tag, err := tx.Exec(ctx, statement, company.String(), connectionID, storedToken, code)
	return tag.RowsAffected() == 1, err
}
