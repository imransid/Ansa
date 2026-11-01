package social

import (
	"context"

	"ansa/core/internal/platforms"
	"ansa/core/internal/tenant"
)

// renew claims the renewal for this run, then asks the platform; what it
// gave is saved guarded by the token the run started from.
func (r *Renewer) renew(ctx context.Context, company tenant.CompanyID, stored *storedConnection, ready Prepared, refreshToken string) (Prepared, error) {
	claimed, err := claimRenewal(ctx, r.Pool, company, stored.id, *stored.accessEncrypted)
	if err != nil {
		return Prepared{}, err
	}
	if !claimed {
		// Another run is renewing it: wait for its new tokens (X may refuse a
		// refresh token that was just used). Even a token with minutes left
		// waits: a publish may take longer.
		return Prepared{Kind: "wait"}, nil
	}
	renewal := r.Platforms.Renew(ctx, stored.platform, refreshToken)
	switch renewal.Kind {
	case "refused":
		return r.markOrLookAgain(ctx, company, stored, "refresh_refused")
	case "refreshed":
		return r.saveRenewal(ctx, company, stored, ready, renewal)
	}
	noted, err := noteProblem(ctx, r.Pool, company, stored.id, *stored.accessEncrypted, "refresh_unavailable")
	if err != nil || !noted {
		return Prepared{Kind: "changed"}, err
	}
	return Prepared{Kind: "unavailable", Code: "refresh_unavailable"}, nil
}

// saveRenewal encrypts the new tokens for this connection and saves them,
// while it still holds the token they replace.
func (r *Renewer) saveRenewal(ctx context.Context, company tenant.CompanyID, stored *storedConnection, ready Prepared, renewal platforms.Renewal) (Prepared, error) {
	access, err := r.Box.Encrypt(renewal.AccessToken, TokenContext(company, stored.id, "access"))
	if err != nil {
		return Prepared{}, err
	}
	renewed := storedConnection{accessEncrypted: &access, accessExpiresAt: renewal.AccessExpiresAt}
	if renewal.RefreshToken != "" {
		refresh, err := r.Box.Encrypt(renewal.RefreshToken, TokenContext(company, stored.id, "refresh"))
		if err != nil {
			return Prepared{}, err
		}
		renewed.refreshEncrypted = &refresh
		// A platform that names no new end leaves the known one.
		renewed.refreshExpiresAt = renewal.RefreshExpiresAt
		if renewed.refreshExpiresAt == nil {
			renewed.refreshExpiresAt = stored.refreshExpiresAt
		}
	}
	saved, err := saveRenewedTokens(ctx, r.Pool, company, stored.id, *stored.accessEncrypted, renewed)
	if err != nil || !saved {
		return Prepared{Kind: "changed"}, err
	}
	ready.Token, ready.StoredToken = renewal.AccessToken, access
	return ready, nil
}

// markOrLookAgain marks the connection as needing a reconnect with this
// code; when it changed meanwhile (disconnected, reconnected, renewed by
// another run), what is stored now is looked at again instead.
func (r *Renewer) markOrLookAgain(ctx context.Context, company tenant.CompanyID, stored *storedConnection, code string) (Prepared, error) {
	marked, err := markNeedsReconnect(ctx, r.Pool, company, stored.id, *stored.accessEncrypted, code)
	if err != nil || !marked {
		return Prepared{Kind: "changed"}, err
	}
	return Prepared{Kind: "needs_reauth", Code: code}, nil
}
