// Package ratelimit counts attempts per action and caller in PostgreSQL (the
// rate_limits table, no Redis), exactly as the old backend does
// (services/rate-limit.ts), so both share the same counters during the move.
//
// The stored key is an HMAC of "<action>:<identifier>" made with a secret
// derived from BETTER_AUTH_SECRET: an IP address or an email can't be read
// back from a copy of the database (docs/backend/security.md, rule 9).
package ratelimit

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"ansa/core/internal/database"
)

// Rule is how many attempts a window allows.
type Rule struct {
	MaxAttempts int
	Window      time.Duration
}

// Limiter counts attempts.
type Limiter struct {
	pool      *database.Pool
	keySecret []byte
}

// New derives the key secret the way the old backend does:
// HMAC-SHA256(BETTER_AUTH_SECRET, "ansa rate limit keys").
func New(pool *database.Pool, authSecret string) *Limiter {
	mac := hmac.New(sha256.New, []byte(authSecret))
	mac.Write([]byte("ansa rate limit keys"))
	return &Limiter{pool: pool, keySecret: mac.Sum(nil)}
}

// Key is the stored key for an action and caller (exported for the test that
// checks it equals the old backend's).
func (l *Limiter) Key(action, identifier string) string {
	mac := hmac.New(sha256.New, l.keySecret)
	mac.Write([]byte(action + ":" + identifier))
	return hex.EncodeToString(mac.Sum(nil))
}

// Over counts one attempt and reports whether the caller went over the rule.
func (l *Limiter) Over(ctx context.Context, action, identifier string, rule Rule) (bool, error) {
	count, err := recordAttempt(ctx, l.pool, l.Key(action, identifier), rule.Window)
	if err != nil {
		return false, fmt.Errorf("ratelimit: %w", err)
	}
	return count > rule.MaxAttempts, nil
}

// TakeBack removes one counted attempt (one that shouldn't count after all).
func (l *Limiter) TakeBack(ctx context.Context, action, identifier string) error {
	return removeAttempt(ctx, l.pool, l.Key(action, identifier))
}
