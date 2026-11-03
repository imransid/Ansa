package social

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// A WhatsApp number's token (step 56) is read here too: this package is
// the only code that decrypts a third-party token
// (TestOnlyThisPackageDecryptsTokens); core/internal/whatsapp only
// encrypts the one Meta gives when a number is connected.

// WhatsAppTokenContext ties a WhatsApp number's access token to its
// company and number: a copy in another row can't be read.
func WhatsAppTokenContext(company tenant.CompanyID, numberID string) string {
	return "whatsapp-token:" + company.String() + ":" + numberID
}

// WhatsAppToken is a connected WhatsApp number's token, ready for one send
// (ErrNotUsable: not connected now, or its token can't be read).
func WhatsAppToken(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, numberID string) (string, error) {
	const statement = `
		SELECT id, token_encrypted FROM whatsapp_numbers
		WHERE company_id = $1 AND id = $2 AND status = 'connected' AND token_encrypted IS NOT NULL`
	var storedID, encrypted string
	err := pool.QueryRow(ctx, statement, company.String(), numberID).Scan(&storedID, &encrypted)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotUsable
	}
	if err != nil {
		return "", err
	}
	// The stored id, as Postgres gives it back: the token was encrypted for it.
	token, err := box.Decrypt(encrypted, WhatsAppTokenContext(company, storedID))
	if err != nil || token == "" {
		return "", ErrNotUsable
	}
	return token, nil
}
