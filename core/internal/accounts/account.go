package accounts

import (
	"context"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/ratelimit"
	"ansa/core/internal/tenant"
)

// Name changes and "log out on all other devices": 30 per 10 minutes per
// person. Current-password guesses by someone holding a logged-in browser:
// 10 per 15 minutes.
var (
	accountChanges  = ratelimit.Rule{MaxAttempts: 30, Window: 10 * time.Minute}
	passwordChanges = ratelimit.Rule{MaxAttempts: 10, Window: 15 * time.Minute}
)

// Details is the Account page.
type Details struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	// Browsers and devices logged in right now, this one included.
	ActiveSessions int `json:"activeSessions"`
}

// ReadDetails reads one person's own account.
func (s *Service) ReadDetails(ctx context.Context, company tenant.CompanyID, userID string) (Details, error) {
	var d Details
	const statement = `
		SELECT users.name, users.email, (SELECT count(*) FROM sessions WHERE sessions.user_id = users.id AND sessions.expires_at > now())
		FROM users WHERE users.company_id = $1 AND users.id = $2`
	err := s.Pool.QueryRow(ctx, statement, company.String(), userID).Scan(&d.Name, &d.Email, &d.ActiveSessions)
	return d, err
}

// ChangeName changes one's own name (checked by the API), shown to teammates.
func (s *Service) ChangeName(ctx context.Context, company tenant.CompanyID, userID, name string) (string, error) {
	if over, err := s.Limits.Over(ctx, "account-changes", userID, accountChanges); err != nil || over {
		return "Too many changes. Try again in a few minutes.", err
	}
	_, err := s.Pool.Exec(ctx, `UPDATE users SET name = $3, updated_at = now() WHERE company_id = $1 AND id = $2`, company.String(), userID, name)
	return "", err
}

// ChangePassword changes one's own password once the current one checks
// out (every attempt counts): every login of the account ends, this browser
// gets a fresh one, and reset links sent earlier stop working. Answers the
// new session cookie, or a message ("currentPassword" names the field).
func (s *Service) ChangePassword(ctx context.Context, company tenant.CompanyID, userID, current, newPassword string, r Request) (Answer, string, error) {
	if over, err := s.Limits.Over(ctx, "password-change", userID, passwordChanges); err != nil || over {
		return Answer{Message: "Too many attempts. Try again in 15 minutes."}, "", err
	}
	var stored string
	const read = `
		SELECT accounts.password FROM accounts JOIN users ON users.id = accounts.user_id
		WHERE users.company_id = $1 AND users.id = $2 AND accounts.provider_id = 'credential' AND accounts.account_id = users.id`
	if err := s.Pool.QueryRow(ctx, read, company.String(), userID).Scan(&stored); err != nil {
		return Answer{}, "", err
	}
	if !VerifyPassword(stored, current) {
		return Answer{}, "That is not your current password.", nil
	}
	hash, err := HashPassword(newPassword)
	if err != nil {
		return Answer{}, "", err
	}
	err = database.InTx(ctx, s.Pool, func(tx database.Tx) error {
		const update = `UPDATE accounts SET password = $2, updated_at = now() WHERE user_id = $1 AND provider_id = 'credential' AND account_id = $1`
		if _, err := tx.Exec(ctx, update, userID, hash); err != nil {
			return err
		}
		return endLoginsAndLinksWithin(ctx, tx, userID)
	})
	if err != nil {
		return Answer{}, "", err
	}
	cookie, opened, err := s.openSession(ctx, userID, r.IP, r.UserAgent)
	if err != nil || !opened {
		return Answer{Message: "Your password is changed. Log in again to continue."}, "", err
	}
	return Answer{Cookies: []Cookie{cookie}}, "", nil
}

// LogOutOthers ends every other login of the person, keeping this one (token).
func (s *Service) LogOutOthers(ctx context.Context, userID, token string) (string, error) {
	if over, err := s.Limits.Over(ctx, "account-changes", userID, accountChanges); err != nil || over {
		return "Too many changes. Try again in a few minutes.", err
	}
	_, err := s.Pool.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1 AND token <> $2`, userID, token)
	return "", err
}
