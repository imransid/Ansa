package teammates

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/publishing"
	"ansa/core/internal/team"
	"ansa/core/internal/tenant"
	"ansa/core/internal/tickets"
)

// SetRole gives one teammate a new role ("owner" or "member"), in ONE
// transaction: the company row lock first; then one UPDATE that holds every
// rule (only an active owner, never to themselves, only a confirmed teammate
// still on the team, and a demotion only while another active owner
// remains, so a company always keeps one). A demotion also revokes the
// pending invites they made and disconnects the LinkedIn profiles they
// connected (those post as them; a member can neither cancel a post nor
// disconnect one). False: nothing changed.
func SetRole(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, teammateID, role string) (bool, error) {
	changed := false
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		const update = `
			UPDATE users SET role = $4::user_role
			WHERE company_id = $1 AND id::text = $3 AND id::text <> $2 AND deactivated_at IS NULL AND email_verified
				AND EXISTS (SELECT 1 FROM users AS acting WHERE acting.company_id = $1 AND acting.id::text = $2 AND acting.role = 'owner' AND acting.deactivated_at IS NULL)
				AND ($4 = 'owner' OR EXISTS (
					SELECT 1 FROM users AS other WHERE other.company_id = $1 AND other.id::text <> $3 AND other.role = 'owner'
						AND other.deactivated_at IS NULL AND other.email_verified))`
		tag, err := tx.Exec(ctx, update, company.String(), actorUserID, teammateID, role)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		changed = true
		if role != "member" {
			return nil
		}
		if err := revokeInvitesOfWithin(ctx, tx, company, teammateID); err != nil {
			return err
		}
		return disconnectProfilesOfWithin(ctx, tx, company, teammateID, "teammate_made_member")
	})
	return changed, err
}

// Remove takes one person off the team, in ONE transaction (the company
// row lock first; only an active owner, never themselves, only someone
// still on the team; their row locked so assigning them a request at this
// moment waits and then sees them removed). A confirmed teammate is
// deactivated: their row stays (requests keep the name), and their logins,
// password, reset links, categories and pending invites go, the LinkedIn
// profiles they connected are disconnected, and their open requests are
// routed again (whoever gets one is emailed after commit). Someone who
// never confirmed never logged in: their account is deleted instead, which
// frees the address. False: nothing changed.
func Remove(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, teammateID string) (bool, error) {
	removed := false
	err := database.InTx(ctx, pool, func(tx database.Tx) error {
		if err := team.LockCompanyWithin(ctx, tx, company); err != nil {
			return err
		}
		const find = `
			SELECT id, email_verified FROM users
			WHERE company_id = $1 AND id::text = $3 AND deactivated_at IS NULL AND id::text <> $2
				AND EXISTS (SELECT 1 FROM users AS acting WHERE acting.company_id = $1 AND acting.id::text = $2 AND acting.role = 'owner' AND acting.deactivated_at IS NULL)
			FOR NO KEY UPDATE`
		var id string
		var confirmed bool
		err := tx.QueryRow(ctx, find, company.String(), actorUserID, teammateID).Scan(&id, &confirmed)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		removed = true
		if !confirmed {
			return deleteUnconfirmedWithin(ctx, tx, company, id)
		}
		return deactivateWithin(ctx, tx, company, id)
	})
	return removed, err
}

// deactivateWithin marks a confirmed teammate removed and ends everything
// they could still use.
func deactivateWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, userID string) error {
	if _, err := tx.Exec(ctx, `UPDATE users SET deactivated_at = now() WHERE company_id = $1 AND id = $2 AND deactivated_at IS NULL`, company.String(), userID); err != nil {
		return err
	}
	if err := endLoginsAndLinksWithin(ctx, tx, company, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM user_categories WHERE company_id = $1 AND user_id = $2`, company.String(), userID); err != nil {
		return err
	}
	if err := revokeInvitesOfWithin(ctx, tx, company, userID); err != nil {
		return err
	}
	if err := disconnectProfilesOfWithin(ctx, tx, company, userID, "teammate_removed"); err != nil {
		return err
	}
	return tickets.UnassignForRemovalWithin(ctx, tx, company, userID)
}

// endLoginsAndLinksWithin logs them out everywhere at once, deletes their
// password (nothing may log in with it again) and kills any reset link in
// their inbox. Better Auth's tables have no company column: the person is
// matched through users, inside this company only.
func endLoginsAndLinksWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, userID string) error {
	for _, statement := range []string{
		`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE company_id = $1 AND id = $2)`,
		`DELETE FROM accounts WHERE user_id IN (SELECT id FROM users WHERE company_id = $1 AND id = $2)`,
		`DELETE FROM verifications WHERE value IN (SELECT id::text FROM users WHERE company_id = $1 AND id = $2)`,
	} {
		if _, err := tx.Exec(ctx, statement, company.String(), userID); err != nil {
			return err
		}
	}
	return nil
}

// deleteUnconfirmedWithin deletes an account that never confirmed its
// address (locked, so confirming it at this moment waits, then finds no
// account): its categories, its place on requests and in their history,
// its reset links, then the account (its login and sessions go with it).
func deleteUnconfirmedWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, userID string) error {
	var id string
	err := tx.QueryRow(ctx, `SELECT id FROM users WHERE company_id = $1 AND id = $2 AND email_verified = false FOR UPDATE`, company.String(), userID).Scan(&id)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM user_categories WHERE company_id = $1 AND user_id = $2`, company.String(), userID); err != nil {
		return err
	}
	if err := tickets.ForgetAccountWithin(ctx, tx, company, userID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM verifications WHERE value IN (SELECT id::text FROM users WHERE company_id = $1 AND id = $2)`, company.String(), userID); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `DELETE FROM users WHERE company_id = $1 AND id = $2 AND email_verified = false`, company.String(), userID)
	return err
}

// disconnectProfilesOfWithin disconnects the LinkedIn profiles a person
// connected (they post AS them), each recorded as done by the app with why.
// Pages, channels and X accounts stay: they may be the business's own.
func disconnectProfilesOfWithin(ctx context.Context, tx database.Tx, company tenant.CompanyID, userID, why string) error {
	const disconnect = `
		UPDATE social_connections SET status = 'disconnected', access_token_encrypted = NULL, refresh_token_encrypted = NULL,
			access_expires_at = NULL, refresh_expires_at = NULL, last_error = NULL, renewal_started_at = NULL,
			disconnected_at = now(), updated_at = now()
		WHERE company_id = $1 AND connected_by_user_id = $2 AND account_kind = 'member' AND status <> 'disconnected'
		RETURNING id`
	rows, err := tx.Query(ctx, disconnect, company.String(), userID)
	if err != nil {
		return err
	}
	var entries []publishing.Activity
	for rows.Next() {
		entry := publishing.Activity{Action: "disconnected", Code: why}
		if err := rows.Scan(&entry.ConnectionID); err != nil {
			rows.Close()
			return err
		}
		entries = append(entries, entry)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return publishing.RecordActivityWithin(ctx, tx, company, entries...)
}

func ignoreNoRows(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	return err
}
