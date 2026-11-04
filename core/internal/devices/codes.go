package devices

import (
	"context"
	"crypto/rand"
	"net/url"
	"strings"
	"time"

	"rsc.io/qr"

	"ansa/core/internal/database"
	"ansa/core/internal/settings"
	"ansa/core/internal/tenant"
)

// A pair code: 8 letters and digits people can read aloud and type without
// doubt (no 0/O, no 1/I/L), shown on the website as XXXX-XXXX, working once
// for 5 minutes.
const (
	codeAlphabet    = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
	codeLength      = 8
	pairCodeMinutes = 5
)

// PairCode is what the website shows: the code, until when it works, the
// link inside the QR code, and the QR code itself.
type PairCode struct {
	Code      string    `json:"code"`
	ExpiresAt time.Time `json:"expiresAt"`
	Link      string    `json:"link"`
	QR        QR        `json:"qr"`
}

// QR is a QR code's modules, one string of 0 (light) and 1 (dark) per row,
// without the quiet zone: the screens draw it (core sends no HTML or image).
type QR struct {
	Size int      `json:"size"`
	Rows []string `json:"rows"`
}

// MakePairCode makes a one-time code for an owner (the company row lock
// first, then the person read again: settings.AsOwner). Only the code's
// SHA-256 is stored. deviceAPIURL is how a phone reaches core (DEVICE_API_URL).
func MakePairCode(ctx context.Context, pool *database.Pool, company tenant.CompanyID, actorUserID, deviceAPIURL string) (PairCode, string, error) {
	code, err := newPairCode()
	if err != nil {
		return PairCode{}, "", err
	}
	made := PairCode{Code: code, Link: pairLink(deviceAPIURL, code)}
	outcome, err := settings.AsOwner(ctx, pool, company, actorUserID, func(tx database.Tx) error {
		const insert = `
			INSERT INTO device_pair_codes (company_id, created_by_user_id, code_hash, expires_at)
			VALUES ($1, $2, $3, now() + make_interval(mins => $4))
			RETURNING expires_at`
		return tx.QueryRow(ctx, insert, company.String(), actorUserID, hashSecret(code), pairCodeMinutes).Scan(&made.ExpiresAt)
	})
	if err != nil || outcome != settings.Saved {
		return PairCode{}, outcome, err
	}
	made.ExpiresAt = made.ExpiresAt.UTC()
	made.QR, err = qrModules(made.Link)
	return made, outcome, err
}

// newPairCode draws each letter evenly from the alphabet: a random byte
// past the last whole multiple of the alphabet's size is drawn again (else
// the first letters would come up a little more often).
func newPairCode() (string, error) {
	limit := byte(256 - 256%len(codeAlphabet))
	code := make([]byte, 0, codeLength)
	buffer := make([]byte, 16)
	for len(code) < codeLength {
		if _, err := rand.Read(buffer); err != nil {
			return "", err
		}
		for _, b := range buffer {
			if b < limit && len(code) < codeLength {
				code = append(code, codeAlphabet[int(b)%len(codeAlphabet)])
			}
		}
	}
	return string(code), nil
}

// NormalizeCode reads a code as people type it: any case, with or without
// its dash and spaces. It reports whether what is left is a code's shape.
func NormalizeCode(typed string) (string, bool) {
	code := strings.ToUpper(strings.NewReplacer("-", "", " ", "").Replace(strings.TrimSpace(typed)))
	if len(code) != codeLength {
		return "", false
	}
	for _, r := range code {
		if !strings.ContainsRune(codeAlphabet, r) {
			return "", false
		}
	}
	return code, true
}

// pairLink is the link inside the QR code: the app opens it, and reaches
// core at the address it names.
func pairLink(deviceAPIURL, code string) string {
	return "ansa://pair?u=" + url.QueryEscape(deviceAPIURL) + "&c=" + code
}

// qrModules draws the link as a QR code (error correction M: a code shown
// on a screen and read by a phone's camera).
func qrModules(link string) (QR, error) {
	code, err := qr.Encode(link, qr.M)
	if err != nil {
		return QR{}, err
	}
	rows := make([]string, code.Size)
	for y := range code.Size {
		var row strings.Builder
		for x := range code.Size {
			if code.Black(x, y) {
				row.WriteByte('1')
			} else {
				row.WriteByte('0')
			}
		}
		rows[y] = row.String()
	}
	return QR{Size: code.Size, Rows: rows}, nil
}
