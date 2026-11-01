// Package session says who is making a request to core's API: the ONLY
// trusted source of a company in core, as lib/session-context.ts is in the
// old backend. Core reads the same login the screens make: Better Auth's
// session cookie, signed with BETTER_AUTH_SECRET, and its row in the
// sessions table. A request without a valid, unexpired session of a person
// still on the team is logged out.
package session

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/jackc/pgx/v5"

	"ansa/core/internal/database"
	"ansa/core/internal/tenant"
)

// Session is who is asking.
type Session struct {
	UserID    string
	CompanyID tenant.CompanyID
	// "owner" or "member".
	Role        string
	Name, Email string
}

// IsOwner: owners run the company (settings, team, billing).
func (s *Session) IsOwner() bool { return s.Role == "owner" }

// Better Auth's cookie: "__Secure-" first on https.
var cookieNames = []string{"__Secure-better-auth.session_token", "better-auth.session_token"}

// Reader reads sessions.
type Reader struct {
	Pool *database.Pool
	// BETTER_AUTH_SECRET: Better Auth signs the cookie with it.
	Secret string
}

// FromRequest is the request's session, or nil when nobody is logged in.
func (r *Reader) FromRequest(ctx context.Context, request *http.Request) (*Session, error) {
	token := r.tokenOf(request)
	if token == "" {
		return nil, nil
	}
	return find(ctx, r.Pool, token)
}

// tokenOf is the session token of a correctly signed cookie, or "".
func (r *Reader) tokenOf(request *http.Request) string {
	for _, name := range cookieNames {
		cookie, err := request.Cookie(name)
		if err != nil {
			continue
		}
		if token, ok := VerifySignedValue(cookie.Value, r.Secret); ok {
			return token
		}
		return ""
	}
	return ""
}

// VerifySignedValue checks a Better Auth signed cookie value: the URL-encoded
// "<value>.<base64 HMAC-SHA256(secret, value)>" (better-call's signCookieValue),
// compared in constant time.
func VerifySignedValue(raw, secret string) (string, bool) {
	decoded, err := url.QueryUnescape(raw)
	if err != nil || secret == "" {
		return "", false
	}
	at := strings.LastIndex(decoded, ".")
	if at <= 0 {
		return "", false
	}
	value, signature := decoded[:at], decoded[at+1:]
	given, err := base64.StdEncoding.DecodeString(signature)
	if err != nil || len(signature) != 44 {
		return "", false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(value))
	if !hmac.Equal(given, mac.Sum(nil)) {
		return "", false
	}
	return value, true
}

// SignValue is what Better Auth would set (the tests use it).
func SignValue(value, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(value))
	return url.QueryEscape(value + "." + base64.StdEncoding.EncodeToString(mac.Sum(nil)))
}

// find reads the session and its person: unexpired, and the person not removed.
func find(ctx context.Context, pool *database.Pool, token string) (*Session, error) {
	const statement = `
		-- cross-company: the session token names one person, whose own company is then the only one used.
		SELECT users.id, users.company_id, users.role, users.name, users.email
		FROM sessions
		JOIN users ON users.id = sessions.user_id
		WHERE sessions.token = $1 AND sessions.expires_at > now() AND users.deactivated_at IS NULL`
	var s Session
	var company string
	err := pool.QueryRow(ctx, statement, token).Scan(&s.UserID, &company, &s.Role, &s.Name, &s.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if s.CompanyID, err = tenant.FromTrustedSource(company); err != nil || (s.Role != "owner" && s.Role != "member") {
		// A malformed row is treated as logged out rather than guessed.
		return nil, nil
	}
	return &s, nil
}
