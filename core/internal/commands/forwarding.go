package commands

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// Forwarding addresses (the old lib/forwarding-address.ts): every company
// has ONE, c-<companies.inbound_token>@<INBOUND_EMAIL_DOMAIN>. The database
// makes the token (32 random hex characters), nobody types or picks it, and
// only ansa's operator replaces it. The address isn't secret: it is the
// Reply-To of the company's "solved" emails.

// ForwardingAddress is the company's forwarding address on this domain.
func ForwardingAddress(ctx context.Context, pool *database.Pool, company tenant.CompanyID, domain string) (string, error) {
	var token string
	err := pool.QueryRow(ctx, `SELECT inbound_token FROM companies WHERE id = $1`, company.String()).Scan(&token)
	if err != nil {
		return "", err
	}
	return "c-" + token + "@" + domain, nil
}

// ErrCompanyGone: the company was deleted meanwhile (nothing changed).
var ErrCompanyGone = Refusal("The company was not found any more. Nothing was changed.")

// ReplaceForwardingAddress gives the company a new token (a new database
// default, as when the company was made) and returns the new address. The
// old address stops at once: mail to it, and replies to emails sent
// before, no longer reach the company.
func ReplaceForwardingAddress(ctx context.Context, pool *database.Pool, company tenant.CompanyID, domain string) (string, error) {
	const statement = `UPDATE companies SET inbound_token = DEFAULT, updated_at = now() WHERE id = $1 RETURNING inbound_token`
	var token string
	err := pool.QueryRow(ctx, statement, company.String()).Scan(&token)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrCompanyGone
	}
	if err != nil {
		return "", err
	}
	return "c-" + token + "@" + domain, nil
}
