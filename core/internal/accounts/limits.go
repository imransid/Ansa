package accounts

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"strconv"
	"strings"
	"time"

	"ansa/core/internal/ratelimit"
)

// Limiter is the rate limiter (ratelimit.Limiter; the tests use it too).
type Limiter interface {
	Over(ctx context.Context, action, identifier string, rule ratelimit.Rule) (bool, error)
	TakeBack(ctx context.Context, action, identifier string) error
}

// The login limits, shared by login and confirming an address so guesses on
// both add up (the old services/login-limits.ts). Fair to real users: a
// stranger guessing from their own IP uses up only that address's counter
// from THEIR IP; an office shares a large per-IP limit; a right password
// takes its attempt back; the per-address cap across all IPs stops guessing
// spread over many, and a browser that logged in to the account before
// counts on its own counter instead, so strangers can't keep the person out
// of the browsers they already use.
var (
	loginPerIP          = ratelimit.Rule{MaxAttempts: 100, Window: 15 * time.Minute}
	loginPerEmailAndIP  = ratelimit.Rule{MaxAttempts: 10, Window: 15 * time.Minute}
	loginPerKnownDevice = ratelimit.Rule{MaxAttempts: 10, Window: 15 * time.Minute}
	loginPerEmail       = ratelimit.Rule{MaxAttempts: 100, Window: time.Hour}
	verifyEmailPerIP    = ratelimit.Rule{MaxAttempts: 20, Window: 15 * time.Minute}
)

// attempt is one login (or confirm) attempt as the limits see it.
type attempt struct {
	email, ip string
	// Set when the browser holds a valid known-device cookie for this address.
	knownDevice string
}

// limitReached counts one password attempt: "" when the password may be
// checked, else which limit refused ("ip", "address-and-ip",
// "known-device", "address"). Each counter counts only when the ones
// before it allowed the attempt.
func (s *Service) limitReached(ctx context.Context, a attempt) (string, error) {
	if over, err := s.Limits.Over(ctx, "login-ip", a.ip, loginPerIP); err != nil || over {
		return "ip", err
	}
	if over, err := s.Limits.Over(ctx, "login-email-ip", a.email+" "+a.ip, loginPerEmailAndIP); err != nil || over {
		return "address-and-ip", err
	}
	if a.knownDevice != "" {
		over, err := s.Limits.Over(ctx, "login-device", a.knownDevice, loginPerKnownDevice)
		if over {
			return "known-device", err
		}
		return "", err
	}
	if over, err := s.Limits.Over(ctx, "login-email", a.email, loginPerEmail); err != nil || over {
		return "address", err
	}
	return "", nil
}

// forgetAttempt takes back the attempt of a right password, so a person's
// own logins never use the limits up for them or their office.
func (s *Service) forgetAttempt(ctx context.Context, a attempt) {
	_ = s.Limits.TakeBack(ctx, "login-ip", a.ip)
	_ = s.Limits.TakeBack(ctx, "login-email-ip", a.email+" "+a.ip)
	if a.knownDevice != "" {
		_ = s.Limits.TakeBack(ctx, "login-device", a.knownDevice)
	} else {
		_ = s.Limits.TakeBack(ctx, "login-email", a.email)
	}
}

// waitAfter is how long until a limit lets attempts through again.
func waitAfter(limit string) string {
	if limit == "address" {
		return "an hour"
	}
	return "15 minutes"
}

// The "known device" cookie: proof that this browser logged in to an
// account before, "<device id>.<expiry, unix seconds>.<signature>" where the
// signature covers the account's address (which is never in the cookie).
// One per browser: the last person who logged in on it.
const (
	KnownDeviceCookieName = "ansa_known_device"
	knownDeviceLifetime   = 90 * 24 * time.Hour
)

func (s *Service) knownDeviceCookie(email string) (Cookie, error) {
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return Cookie{}, err
	}
	deviceID := base64.RawURLEncoding.EncodeToString(random)
	expires := s.now().Add(knownDeviceLifetime).Unix()
	value := deviceID + "." + strconv.FormatInt(expires, 10) + "." + s.knownDeviceSignature(email, deviceID, expires)
	return Cookie{Name: KnownDeviceCookieName, Value: value, MaxAge: int(knownDeviceLifetime.Seconds()), HTTPOnly: true, Secure: s.secure(), SameSite: "lax", Path: "/"}, nil
}

// knownDeviceID is the device id of a valid cookie for this address, or ""
// (none, expired, altered, or another address's).
func (s *Service) knownDeviceID(cookieValue, email string) string {
	parts := strings.Split(cookieValue, ".")
	if len(parts) != 3 {
		return ""
	}
	expires, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || expires < s.now().Unix() {
		return ""
	}
	if !hmac.Equal([]byte(parts[2]), []byte(s.knownDeviceSignature(email, parts[0], expires))) {
		return ""
	}
	return parts[0]
}

// knownDeviceSignature uses a key of its own made from the secret, so
// nothing else signed with it can pass for one of these.
func (s *Service) knownDeviceSignature(email, deviceID string, expires int64) string {
	keyMAC := hmac.New(sha256.New, []byte(s.Secret))
	keyMAC.Write([]byte("ansa known-device cookie"))
	mac := hmac.New(sha256.New, keyMAC.Sum(nil))
	mac.Write([]byte(email + "\n" + deviceID + "\n" + strconv.FormatInt(expires, 10)))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
