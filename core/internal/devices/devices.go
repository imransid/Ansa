// Package devices is the ansa phone app's side of core. An owner shows a QR
// code on ansa's website; the app scans it and is connected to that account
// (pairing.go), with a token of its own that names the phone, and so the
// company, on every call it makes (auth.go). While the app runs it checks
// in (checkin.go). When none of the owners' connected phones has checked in
// for the minutes the owner chose, the presence watcher switches ansa to
// away by itself, exactly as "I'm away" does (watcher.go), and the next
// check-in switches it back, but only an away the phones set: a person's
// own "I'm away" is never undone.
package devices

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"time"

	"ansa/core/internal/tenant"
)

// The minutes an owner may choose ("Answer for me when my phone is
// unreachable for N minutes"), and the one until they choose.
var waitMinutesAllowed = map[int]bool{1: true, 5: true, 15: true, 30: true}

const defaultWaitMinutes = 5

// WaitMinutesAllowed says whether an owner may choose these minutes.
func WaitMinutesAllowed(minutes int) bool {
	return waitMinutesAllowed[minutes]
}

// A company keeps at most this many connected phones: a ceiling, so codes
// shown again and again can't add phones without end.
const MaxDevicesPerCompany = 10

// The phone's name as the app sends it ("Rafa's iPhone"): one plain line.
const maxNameLength = 60

// Device is a connected phone, as its token found it: the phone, its
// company and the owner whose code paired it (the phone acts as them).
type Device struct {
	ID             string
	Company        tenant.CompanyID
	PairedByUserID string
}

// hashSecret is what a pair code or a device token is stored as: its
// SHA-256, as hex. A token is 256 random bits, so no key is needed; a pair
// code is short, but lives 5 minutes, works once, and guessing it is held
// back by the per-IP limit.
func hashSecret(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

// newDeviceToken is a phone's token: 32 random bytes, given to the app
// once and never stored or logged in clear.
func newDeviceToken() (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

// rfc3339 writes a time as the app reads it ("" for none).
func rfc3339(t *time.Time) string {
	if t == nil {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}
