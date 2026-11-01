package accounts

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// Request is who is asking, as the screens saw the browser: its IP (for
// the limits), its browser, and its known-device cookie.
type Request struct {
	IP, UserAgent, KnownDeviceCookie string
}

// Answer is what a login-like call ends in: Message (for the person) when
// it didn't work; else the cookies for the screens to set.
type Answer struct {
	Message string   `json:"message,omitempty"`
	Cookies []Cookie `json:"cookies,omitempty"`
}

// The answers shared by login and confirming an address.
const (
	wrongPassword  = "Email or password is incorrect."
	confirmFirst   = "Please confirm your email address first: open the newest confirmation email we sent you."
	couldNotLogIn  = "Could not log you in. Please try again."
	wrongLinkOrPwd = "This link has expired or the password is wrong. Try your password again, or log in to get a new link."
)

// credential is one account's password row, as Better Auth keeps it.
type credential struct {
	userID, email, password string
	confirmed, removed      bool
}

// findCredential is the account of an address with its stored password
// (nil: no such account, or one without a password).
func (s *Service) findCredential(ctx context.Context, email string) (*credential, error) {
	const statement = `
		-- cross-company: logging in names a person by their address (unique across companies); only their own row is read.
		SELECT users.id, users.email, accounts.password, users.email_verified, users.deactivated_at IS NOT NULL
		FROM users JOIN accounts ON accounts.user_id = users.id AND accounts.provider_id = 'credential' AND accounts.account_id = users.id
		WHERE users.email = $1 AND accounts.password IS NOT NULL`
	var c credential
	err := s.Pool.QueryRow(ctx, statement, email).Scan(&c.userID, &c.email, &c.password, &c.confirmed, &c.removed)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

// checkPassword checks an address's password, taking as long when there is
// no such account. The account is returned only when the password is right.
func (s *Service) checkPassword(ctx context.Context, email, password string) (*credential, error) {
	found, err := s.findCredential(ctx, email)
	if err != nil {
		return nil, err
	}
	if found == nil {
		spendPasswordTime(password)
		return nil, nil
	}
	if !VerifyPassword(found.password, password) {
		return nil, nil
	}
	return found, nil
}

// LogIn logs in with an address (already lower-cased and checked) and a
// password: the limits first; a right password takes its attempt back;
// an unconfirmed account gets a fresh confirmation link (at most 3 an hour)
// and no session; a removed person gets no session either (and is told only
// that the password is wrong). Then the session cookie and a known-device
// cookie for this browser.
func (s *Service) LogIn(ctx context.Context, emailAddress, password string, r Request) (Answer, error) {
	a := attempt{email: emailAddress, ip: r.IP, knownDevice: s.knownDeviceID(r.KnownDeviceCookie, emailAddress)}
	limit, err := s.limitReached(ctx, a)
	if err != nil {
		return Answer{}, err
	}
	if limit == "address" {
		return Answer{Message: "Too many failed logins for this address. Try again in an hour, or from a browser you have logged in with before."}, nil
	}
	if limit != "" {
		return Answer{Message: "Too many login attempts. Try again in " + waitAfter(limit) + "."}, nil
	}
	found, err := s.checkPassword(ctx, emailAddress, password)
	if err != nil {
		return Answer{}, err
	}
	if found == nil {
		return Answer{Message: wrongPassword}, nil
	}
	// The password was right: not a failed attempt, whatever happens next.
	s.forgetAttempt(ctx, a)
	if found.removed {
		return Answer{Message: wrongPassword}, nil
	}
	if !found.confirmed {
		s.sendConfirmation(ctx, found.userID, found.email)
		return Answer{Message: confirmFirst}, nil
	}
	return s.logInBrowser(ctx, found.userID, found.email, r)
}

// logInBrowser opens the session and remembers this browser for the address.
func (s *Service) logInBrowser(ctx context.Context, userID, emailAddress string, r Request) (Answer, error) {
	sessionCookie, opened, err := s.openSession(ctx, userID, r.IP, r.UserAgent)
	if err != nil {
		return Answer{}, err
	}
	if !opened {
		return Answer{Message: couldNotLogIn}, nil
	}
	device, err := s.knownDeviceCookie(emailAddress)
	if err != nil {
		return Answer{}, err
	}
	return Answer{Cookies: []Cookie{sessionCookie, device}}, nil
}

// sendConfirmation mails a confirmation link: "#<token>", so the token
// never reaches a server or its logs (the page reads it in the browser).
func (s *Service) sendConfirmation(ctx context.Context, userID, emailAddress string) {
	subject, text, htmlBody := confirmEmail(s.AppURL + "/verify-email#" + signupToken(emailAddress, s.Secret, s.now()))
	s.sendAccountEmail(ctx, "verification-email", emailAddress, userID, subject, text, htmlBody)
}

// ConfirmEmail confirms an address with the link's token AND the account's
// password, then logs in: a link alone never confirms or logs in anyone
// (whoever signed up with someone else's address knows the password but
// never sees the link; the inbox owner sees the link but not that password).
// The same limits as login, so guesses on both pages add up; a bad link and
// a wrong password get one answer, and take as long.
func (s *Service) ConfirmEmail(ctx context.Context, token, password string, r Request) (Answer, error) {
	if over, err := s.Limits.Over(ctx, "verify-email", r.IP, verifyEmailPerIP); err != nil || over {
		return Answer{Message: "Too many attempts. Try again in 15 minutes."}, err
	}
	emailAddress := emailOfSignupToken(token, s.Secret, s.now())
	if emailAddress == "" {
		spendPasswordTime(password)
		return Answer{Message: wrongLinkOrPwd}, nil
	}
	a := attempt{email: emailAddress, ip: r.IP, knownDevice: s.knownDeviceID(r.KnownDeviceCookie, emailAddress)}
	limit, err := s.limitReached(ctx, a)
	if err != nil || limit != "" {
		return Answer{Message: "Too many attempts. Try again in " + waitAfter(limit) + "."}, err
	}
	found, err := s.checkPassword(ctx, emailAddress, password)
	if err != nil {
		return Answer{}, err
	}
	if found == nil {
		return Answer{Message: wrongLinkOrPwd}, nil
	}
	s.forgetAttempt(ctx, a)
	if found.removed {
		return Answer{Message: wrongLinkOrPwd}, nil
	}
	if !found.confirmed {
		const confirm = `UPDATE users SET email_verified = true, updated_at = now() WHERE id = $1 AND email = $2 AND deactivated_at IS NULL`
		if _, err := s.Pool.Exec(ctx, confirm, found.userID, emailAddress); err != nil {
			return Answer{}, err
		}
	}
	return s.logInBrowser(ctx, found.userID, emailAddress, r)
}
