package billing

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"
	"time"
)

// SignedByStripe checks Stripe's signature header ("t=<time>,v1=<hex>,...")
// on these exact bytes: HMAC-SHA256 of "<t>.<body>" with the webhook's
// secret, made in the last 5 minutes (the signed time stops replays).
// Parses nothing else, compared in constant time.
func SignedByStripe(body []byte, header, secret string, now time.Time) bool {
	if secret == "" {
		return false
	}
	var timestamp string
	var signatures []string
	for _, part := range strings.Split(header, ",") {
		key, value, _ := strings.Cut(strings.TrimSpace(part), "=")
		switch key {
		case "t":
			timestamp = value
		case "v1":
			signatures = append(signatures, value)
		}
	}
	seconds, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || now.Sub(time.Unix(seconds, 0)).Abs() > 5*time.Minute {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "."))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	for _, signature := range signatures {
		if hmac.Equal([]byte(signature), []byte(expected)) {
			return true
		}
	}
	return false
}
