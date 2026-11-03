package teammates

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/packages"
	"ansa/core/internal/tenant"
)

// An invite works for 7 days, once, for one address.
const inviteLifetime = 7 * 24 * time.Hour

// CreateInvite makes a 7-day, single-use invite for one address to join the
// company with a role, while the person creating it is an active owner
// (their row locked FOR SHARE: a removal or demotion being saved at that
// moment is waited for, then seen, so nobody walks back in through an
// invite made at that instant). Only the token's SHA-256 is stored; the
// token itself goes only into the link (after "#", which browsers never
// send to a server). Outcomes: "created" (with the token), "not-allowed",
// "taken" (the address is someone's on the team, or someone removed),
// "team-full" (the package's team members, pending invites counted, step 57).
func CreateInvite(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, email, role string, now time.Time) (token, outcome string, err error) {
	var taken bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE company_id = $1 AND email = $2)`, company.String(), email).Scan(&taken); err != nil {
		return "", "", err
	}
	if taken {
		return "", "taken", nil
	}
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return "", "", err
	}
	token = base64.RawURLEncoding.EncodeToString(random)
	outcome = "not-allowed"
	err = database.InTx(ctx, pool, func(tx database.Tx) error {
		var creator string
		const lockCreator = `
			SELECT id FROM users WHERE company_id = $1 AND id = $2 AND role = 'owner' AND deactivated_at IS NULL FOR SHARE`
		if err := tx.QueryRow(ctx, lockCreator, company.String(), actorUserID).Scan(&creator); err != nil {
			return ignoreNoRows(err)
		}
		seatLeft, err := packages.TeamSeatLeftWithin(ctx, tx, company, now)
		if err != nil || !seatLeft {
			outcome = "team-full"
			return err
		}
		const insert = `
			INSERT INTO invites (company_id, email, role, token_hash, created_by_user_id, expires_at)
			VALUES ($1, $2, $3, $4, $5, $6)`
		if _, err := tx.Exec(ctx, insert, company.String(), email, role, HashInviteToken(token), actorUserID, now.Add(inviteLifetime)); err != nil {
			return err
		}
		outcome = "created"
		return nil
	})
	if outcome != "created" {
		token = ""
	}
	return token, outcome, err
}

// HashInviteToken is what invites.token_hash stores: the token's SHA-256, hex.
func HashInviteToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// RevokeInvite revokes one pending invite of the company: its link stops
// working. False: no such pending invite here (used, revoked, expired,
// another company's).
func RevokeInvite(ctx context.Context, pool *database.Pool, company tenant.CompanyID, inviteID string) (bool, error) {
	const revoke = `
		UPDATE invites SET revoked_at = now()
		WHERE company_id = $1 AND id::text = $2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`
	tag, err := pool.Exec(ctx, revoke, company.String(), inviteID)
	return tag.RowsAffected() == 1, err
}

// pendingInvites are the company's invites that can still be used, oldest first.
func pendingInvites(ctx context.Context, pool *database.Pool, company tenant.CompanyID) ([]Invite, error) {
	const statement = `
		SELECT id, email, role, expires_at FROM invites
		WHERE company_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
		ORDER BY created_at`
	rows, err := pool.Query(ctx, statement, company.String())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	invites := []Invite{}
	for rows.Next() {
		var invite Invite
		if err := rows.Scan(&invite.ID, &invite.Email, &invite.Role, &invite.ExpiresAt); err != nil {
			return nil, err
		}
		invites = append(invites, invite)
	}
	return invites, rows.Err()
}

// revokeInvitesOfWithin revokes every pending invite one person created
// (they are being removed or made a member): otherwise a departing or
// demoted owner could invite a private address and walk back in.
func revokeInvitesOfWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, userID string) error {
	const revoke = `
		UPDATE invites SET revoked_at = now()
		WHERE company_id = $1 AND created_by_user_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`
	_, err := tx.Exec(ctx, revoke, company.String(), userID)
	return err
}
