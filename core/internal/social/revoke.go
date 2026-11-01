package social

import (
	"context"

	"ansa/core/internal/contentrules"
	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/platforms"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// Removed is what a disconnect took off one connection: whose it was and
// its tokens, still encrypted ("" when there was none). Nothing else ever
// reads a disconnected connection's tokens.
type Removed struct {
	ConnectionID, Platform, ExternalID string
	IsStandIn                          bool
	AccessEncrypted, RefreshEncrypted  string
}

// RevokeRemoved asks the platform to take back the tokens a disconnect
// removed, where it offers that (X and Google), right after the answer
// (the old services/social-disconnect.ts). Not while the account is still
// connected anywhere: X's and Google's grant is the account's with ansa's
// one app, so the revoke would end another company's connection of it
// too (or this company's, connected again meanwhile); the last company to
// disconnect it has it revoked. Best effort: a failure is one fixed log
// line, and the account is disconnected either way. It returns what
// happened: revoked, not_offered, still_connected, or the failure's code.
func RevokeRemoved(ctx context.Context, pool *database.Pool, box *secure.Box, connectors *platforms.Connectors, log *logging.Logger, company tenant.CompanyID, removed Removed) string {
	if removed.IsStandIn || !contentrules.RevokesOnRequest[removed.Platform] {
		return "not_offered"
	}
	stillConnected, err := connectedAnywhere(ctx, pool, removed.Platform, removed.ExternalID)
	if err != nil {
		log.Error("social: revoke failed", logging.ErrorType(err))
		return "failed"
	}
	if stillConnected {
		log.Info("social: revoke skipped, the account is still connected", logging.Code(removed.Platform))
		return "still_connected"
	}
	// The connection's own id names both tokens' context. One that can't be
	// read (a wrong DATA_ENCRYPTION_KEY) is not sent.
	accessToken, _ := decryptOrNothing(box, removed.AccessEncrypted, TokenContext(company, removed.ConnectionID, "access"))
	refreshToken, _ := decryptOrNothing(box, removed.RefreshEncrypted, TokenContext(company, removed.ConnectionID, "refresh"))
	outcome := connectors.Revoke(ctx, removed.Platform, accessToken, refreshToken)
	if outcome != "revoked" && outcome != "not_offered" {
		log.Warn("social: revoke failed", logging.Code(outcome))
	}
	return outcome
}

func decryptOrNothing(box *secure.Box, stored, tokenContext string) (string, error) {
	if stored == "" {
		return "", nil
	}
	return box.Decrypt(stored, tokenContext)
}

// connectedAnywhere says whether some connection of this platform account
// still holds its tokens (connected, or waiting for a reconnect), in any
// company. Yes or no only: never which company or anything of its rows.
func connectedAnywhere(ctx context.Context, pool *database.Pool, platform, externalID string) (bool, error) {
	const statement = `
		-- cross-company: a Google or X grant is the account's with ansa's one app; yes or no only, nothing of the rows.
		SELECT EXISTS (
			SELECT 1 FROM social_connections
			WHERE platform = $1 AND external_account_id = $2 AND status <> 'disconnected')`
	var connected bool
	err := pool.QueryRow(ctx, statement, platform, externalID).Scan(&connected)
	return connected, err
}
