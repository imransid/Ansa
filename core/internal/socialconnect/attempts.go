package socialconnect

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/secure"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
)

// One company's connection attempts (the old db/oauth-states.ts): saved
// when an owner presses Connect, used once when the platform sends them
// back. Only the state's hash is stored; X's and YouTube's PKCE verifier
// encrypted for its company and attempt (a CHECK allows it exactly there).
// Expired ones are deleted by the hourly cleanup.

// createAttempt saves one attempt while actorUserID is an active owner
// (the role read again FOR SHARE). It works for 10 minutes by the
// database's clock.
func createAttempt(ctx context.Context, pool *database.Pool, box *secure.Box, company tenant.CompanyID, actorUserID, platform, stateHash, verifier string) (bool, error) {
	id, err := conversations.NewID()
	if err != nil {
		return false, err
	}
	var verifierEncrypted *string
	if verifier != "" {
		encrypted, err := box.Encrypt(verifier, pkceContext(company, id))
		if err != nil {
			return false, err
		}
		verifierEncrypted = &encrypted
	}
	saved := false
	err = database.InTx(ctx, pool, func(tx database.Tx) error {
		role, err := team.RoleWithin(ctx, tx, company, actorUserID)
		if err != nil || role != "owner" {
			return err
		}
		const insert = `
			INSERT INTO oauth_states (id, company_id, user_id, platform, state_hash, pkce_verifier_encrypted, expires_at)
			VALUES ($1, $2, $3, $4, $5, $6, now() + interval '10 minutes')`
		if _, err := tx.Exec(ctx, insert, id, company.String(), actorUserID, platform, stateHash, verifierEncrypted); err != nil {
			return err
		}
		saved = true
		return nil
	})
	return saved, err
}

// claimedAttempt is the attempt a return used: its id and its verifier,
// still encrypted (nil: the platform has no PKCE).
type claimedAttempt struct {
	id                string
	verifierEncrypted *string
}

// claimAttempt marks the attempt with this state's hash used, if it is
// this person's, in this company, for this platform, unused and unexpired,
// all in the ONE UPDATE that finds it: of two returns with the same state
// at the same moment, the second waits for the first's row lock, then
// matches nothing. nil: no attempt matched.
func claimAttempt(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, platform, stateHash string) (*claimedAttempt, error) {
	const claim = `
		UPDATE oauth_states SET used_at = now()
		WHERE company_id = $1 AND user_id = $2 AND platform = $3 AND state_hash = $4 AND used_at IS NULL AND expires_at > now()
		RETURNING id, pkce_verifier_encrypted`
	var attempt claimedAttempt
	err := pool.QueryRow(ctx, claim, company.String(), actorUserID, platform, stateHash).Scan(&attempt.id, &attempt.verifierEncrypted)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &attempt, nil
}
