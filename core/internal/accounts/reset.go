package accounts

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/teammates"
	"ansa/core/internal/tenant"
)

// Asking for links: 20 an hour per IP (and 3 emails an hour per address).
// Using links: 20 per 15 minutes per IP (they can't be guessed; this only
// stops hammering).
var (
	resetRequestsPerIP = ratelimit.Rule{MaxAttempts: 20, Window: time.Hour}
	resetsPerIP        = ratelimit.Rule{MaxAttempts: 20, Window: 15 * time.Minute}
)

const linkNotValid = "This link has expired or is not valid. Ask for a new one."

// RequestReset answers every address the same way (the form never tells
// who has an account), and does the work AFTER the answer (in the
// background), so timing tells nothing either.
func (s *Service) RequestReset(ctx context.Context, emailAddress string, r Request) (string, error) {
	if over, err := s.Limits.Over(ctx, "password-reset-request", r.IP, resetRequestsPerIP); err != nil || over {
		return "Too many requests. Try again in an hour.", err
	}
	go s.sendResetLink(context.WithoutCancel(ctx), emailAddress)
	return "", nil
}

// sendResetLink: at most 3 an hour per address (counted for every address);
// every account gets its link, unconfirmed ones too (that is how the owner
// of an inbox takes back an address someone else signed up), but a removed
// person gets nothing. Only the link's hash is stored (Better Auth's own
// format); the link is "#<token>", so the token never reaches a server log.
func (s *Service) sendResetLink(ctx context.Context, emailAddress string) {
	if over, err := s.Limits.Over(ctx, "password-reset-email", emailAddress, accountEmailsPerAddress); err != nil || over {
		return
	}
	var userID string
	var removed bool
	err := s.Pool.QueryRow(ctx, `SELECT id, deactivated_at IS NOT NULL FROM users WHERE email = $1`, emailAddress).Scan(&userID, &removed)
	if err != nil || removed {
		return
	}
	token, err := newID(24)
	if err != nil {
		return
	}
	id, err := newID(32)
	if err != nil {
		return
	}
	const insert = `INSERT INTO verifications (id, identifier, value, expires_at, created_at, updated_at) VALUES ($1, $2, $3, $4, now(), now())`
	if _, err := s.Pool.Exec(ctx, insert, id, resetIdentifier(token), userID, s.now().Add(linkLifetime)); err != nil {
		return
	}
	subject, text, htmlBody := resetEmail(s.AppURL + "/reset-password#" + token)
	s.sendEmailNow(ctx, "password-reset-email", emailAddress, userID, subject, text, htmlBody)
}

// ResetWithToken uses a reset link. Whose link it is decides what it may
// do: a removed person's link does nothing; an unconfirmed account that
// joined through an invite (the address may be a typo, or an owner's
// squat) is REMOVED instead ("account-removed"), which frees the address;
// otherwise the new password is set, the link used up, every login of the
// account ended and its other links voided, in ONE transaction
// ("password-changed"). An unconfirmed own signup still confirms its
// address afterwards (link plus the new password). Else a message.
func (s *Service) ResetWithToken(ctx context.Context, token, newPassword string, r Request) (outcome, message string, err error) {
	if over, err := s.Limits.Over(ctx, "password-reset", r.IP, resetsPerIP); err != nil || over {
		return "", "Too many attempts. Try again in 15 minutes.", err
	}
	if !resetTokenShape.MatchString(token) {
		return "", linkNotValid, nil
	}
	var userID, companyText, emailAddress string
	var confirmed, removed bool
	const find = `
		SELECT users.id, users.company_id, users.email, users.email_verified, users.deactivated_at IS NOT NULL
		FROM verifications JOIN users ON users.id = verifications.value
		WHERE verifications.identifier = $1 AND verifications.expires_at > now()`
	err = s.Pool.QueryRow(ctx, find, resetIdentifier(token)).Scan(&userID, &companyText, &emailAddress, &confirmed, &removed)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && removed) {
		return "", linkNotValid, nil
	}
	if err != nil {
		return "", "", err
	}
	company, err := tenant.FromTrustedSource(companyText)
	if err != nil {
		return "", "", err
	}
	if !confirmed {
		invited, err := s.joinedThroughInvite(ctx, company, emailAddress)
		if err != nil {
			return "", "", err
		}
		if invited {
			gone, err := teammates.RemoveUnconfirmed(ctx, s.Pool, company, userID)
			if err != nil || gone {
				return "account-removed", "", err
			}
			// Confirmed a moment ago: an ordinary reset from here on.
		}
	}
	return s.setNewPassword(ctx, token, userID, newPassword)
}

func (s *Service) setNewPassword(ctx context.Context, token, userID, newPassword string) (string, string, error) {
	hash, err := HashPassword(newPassword)
	if err != nil {
		return "", "", err
	}
	used := false
	err = database.InTx(ctx, s.Pool, func(tx database.Tx) error {
		tag, err := tx.Exec(ctx, `DELETE FROM verifications WHERE identifier = $1 AND value = $2 AND expires_at > now()`, resetIdentifier(token), userID)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		used = true
		const password = `UPDATE accounts SET password = $2, updated_at = now() WHERE user_id = $1 AND provider_id = 'credential' AND account_id = $1`
		if _, err := tx.Exec(ctx, password, userID, hash); err != nil {
			return err
		}
		return endLoginsAndLinksWithin(ctx, tx, userID)
	})
	if err != nil || !used {
		return "", linkNotValid, err
	}
	return "password-changed", "", nil
}

// joinedThroughInvite: an invite for this address was used to join this company.
func (s *Service) joinedThroughInvite(ctx context.Context, company tenant.CompanyID, emailAddress string) (bool, error) {
	var invited bool
	err := s.Pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM invites WHERE company_id = $1 AND email = $2 AND accepted_at IS NOT NULL)`, company.String(), emailAddress).Scan(&invited)
	return invited, err
}

// endLoginsAndLinksWithin ends every login of a person and voids their
// other reset links (after their password changed).
func endLoginsAndLinksWithin(ctx context.Context, tx database.Tx, userID string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1`, userID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `DELETE FROM verifications WHERE value = $1`, userID)
	return err
}
