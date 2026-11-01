package accounts

import (
	"context"
	"strings"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/session"
)

// A login lasts exactly 7 days (never renewed), then you log in again.
const sessionLifetime = 7 * 24 * time.Hour

// Cookie is a cookie for the screens to set on the browser (the browser
// talks to the screens, never to core). MaxAge 0 with Value "" clears it.
type Cookie struct {
	Name     string `json:"name"`
	Value    string `json:"value"`
	MaxAge   int    `json:"maxAge"`
	HTTPOnly bool   `json:"httpOnly"`
	Secure   bool   `json:"secure"`
	SameSite string `json:"sameSite"`
	Path     string `json:"path"`
}

// Service holds what every accounts call needs.
type Service struct {
	Pool *database.Pool
	// BETTER_AUTH_SECRET: signs the session cookie and confirmation links.
	Secret string
	// The screens' own address ("https://..." makes cookies Secure).
	AppURL string
	Mail   Mailer
	Limits Limiter
	Log    *logging.Logger
	// Only the tests replace it.
	Now func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Service) secure() bool {
	return strings.HasPrefix(s.AppURL, "https://")
}

// sessionCookie is Better Auth's own cookie ("__Secure-" first on https),
// the token signed with the secret, as core's session reader expects.
func (s *Service) sessionCookie(token string) Cookie {
	name := "better-auth.session_token"
	if s.secure() {
		name = "__Secure-" + name
	}
	return Cookie{Name: name, Value: session.SignValue(token, s.Secret), MaxAge: int(sessionLifetime.Seconds()), HTTPOnly: true, Secure: s.secure(), SameSite: "lax", Path: "/"}
}

// openSession opens a login for a person who is not removed (a removed
// person never gets one, whatever opened it): its row in Better Auth's
// sessions table, with the IP and browser as Better Auth keeps them.
// opened=false: they were removed.
func (s *Service) openSession(ctx context.Context, userID, ip, userAgent string) (Cookie, bool, error) {
	id, err := newID(32)
	if err != nil {
		return Cookie{}, false, err
	}
	token, err := newID(32)
	if err != nil {
		return Cookie{}, false, err
	}
	const insert = `
		INSERT INTO sessions (id, token, expires_at, ip_address, user_agent, user_id)
		SELECT $1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), users.id FROM users
		WHERE users.id = $6 AND users.deactivated_at IS NULL`
	tag, err := s.Pool.Exec(ctx, insert, id, token, s.now().Add(sessionLifetime), ip, cut(userAgent, 500), userID)
	if err != nil || tag.RowsAffected() == 0 {
		return Cookie{}, false, err
	}
	return s.sessionCookie(token), true, nil
}

// LogOut ends the login of this token (read from a correctly signed
// cookie by the caller: a forged one ends nothing) and answers the cookie
// that clears it.
func (s *Service) LogOut(ctx context.Context, token string) (Cookie, error) {
	if token != "" {
		if _, err := s.Pool.Exec(ctx, `DELETE FROM sessions WHERE token = $1`, token); err != nil {
			return Cookie{}, err
		}
	}
	cleared := s.sessionCookie("")
	cleared.Value, cleared.MaxAge = "", -1
	return cleared, nil
}

func cut(text string, limit int) string {
	runes := []rune(text)
	if len(runes) > limit {
		return string(runes[:limit])
	}
	return text
}
