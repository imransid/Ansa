// Package brainclient is core's only way to talk to the brain (Python).
// Every request is signed, so the brain refuses anything core didn't send:
// HMAC-SHA256 over "<unix seconds>.<body>" with BRAIN_SHARED_SECRET, in the
// X-Ansa-Timestamp and X-Ansa-Signature headers (docs/backend/security.md,
// rule 6). The brain checks it in brain/brain/security.py the same way.
package brainclient

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"time"
)

const (
	// TimestampHeader carries the signing time in unix seconds.
	TimestampHeader = "X-Ansa-Timestamp"
	// SignatureHeader carries the hex HMAC.
	SignatureHeader = "X-Ansa-Signature"
)

// Sign returns the two header values for this body, signed now.
func Sign(secret string, body []byte, now time.Time) (timestamp, signature string) {
	timestamp = strconv.FormatInt(now.Unix(), 10)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp))
	mac.Write([]byte("."))
	mac.Write(body)
	return timestamp, hex.EncodeToString(mac.Sum(nil))
}
