// Package accounts is everything that opens or closes a login, and a
// person's own account (the old services/signup.ts, auth.ts,
// password-reset*.ts, account.ts, login-limits.ts, email-verification.ts,
// company-membership.ts, lib/known-device.ts and Better Auth itself): signup
// and joining through an invite, confirming an address (the link AND the
// password), login with fair limits, password reset, name and password
// changes, logging out. It reads and writes Better Auth's own tables in
// Better Auth's own formats, so logins, passwords and links made by either
// backend keep working during the move.
//
// LOGGING RULE: never a password, a token, a link or an address.
package accounts

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"strings"

	"golang.org/x/crypto/scrypt"
	"golang.org/x/text/unicode/norm"
)

// Better Auth's password settings (@better-auth/utils, password.node):
// scrypt N=16384, r=16, p=1, a 64-byte key, the password in its NFKC form,
// and the salt used AS its hex text (not decoded): "<salt hex>:<key hex>".
const (
	scryptN      = 16384
	scryptR      = 16
	scryptP      = 1
	scryptKeyLen = 64
)

// Passwords are 12 to 128 characters.
const (
	PasswordMin = 12
	PasswordMax = 128
)

// HashPassword is a new stored password ("<salt>:<key>", hex).
func HashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	saltHex := hex.EncodeToString(salt)
	key, err := deriveKey(password, saltHex)
	if err != nil {
		return "", err
	}
	return saltHex + ":" + hex.EncodeToString(key), nil
}

// VerifyPassword says whether password is the one stored (compared in
// constant time). A stored value of another shape is never a match.
func VerifyPassword(stored, password string) bool {
	saltHex, keyHex, found := strings.Cut(stored, ":")
	if !found || saltHex == "" || keyHex == "" {
		return false
	}
	key, err := deriveKey(password, saltHex)
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(hex.EncodeToString(key)), []byte(keyHex)) == 1
}

// spendPasswordTime takes as long as one password check without checking
// anything: an answer for an unknown address or a bad link never comes back
// faster than a wrong password.
func spendPasswordTime(password string) {
	_, _ = deriveKey(password, "0000000000000000000000000000000000")
}

func deriveKey(password, saltHex string) ([]byte, error) {
	if saltHex == "" {
		return nil, errors.New("accounts: no salt")
	}
	return scrypt.Key([]byte(norm.NFKC.String(password)), []byte(saltHex), scryptN, scryptR, scryptP, scryptKeyLen)
}
