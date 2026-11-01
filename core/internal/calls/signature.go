// Package calls is phone calls (the old services/vapi-webhook.ts,
// services/calls.ts, services/call-analysis.ts, services/call-escalation.ts,
// services/call-recordings.ts, services/vapi-tool-calls.ts and their /db
// files): Vapi answers the phone, its signed end-of-call report is saved
// (the transcript encrypted), the brain decides "solved" or "a person
// follows up" ([brain] /v1/calls/decide), every "needs a person" becomes a
// request in the same transaction, the recording is copied into private
// storage, and the live assistant can search the company's knowledge.
// NOT TESTED against a real Vapi account (none yet): its signing format is
// settings (VAPI_*), as the old backend's.
//
// LOGGING RULE: never a transcript, a phone number, a recording address, a
// body or an error's message: fixed lines and class names only.
package calls

import (
	"crypto/hmac"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"hash"
	"regexp"
	"strconv"
	"strings"
	"time"

	"ansa/core/internal/config"
)

// Signing is how Vapi signs (settings, so the first real call can be
// matched without changing code). The old backend's defaults: HMAC-SHA256
// in x-signature over "<x-timestamp>.<body>", hex, seconds, 5 minutes.
type Signing struct {
	Secret, SignatureHeader, TimestampHeader string
	// "sha256", "sha512" or "sha1".
	Algorithm string
	// "{timestamp}.{body}" or "{body}".
	Payload string
	// "hex" or "base64".
	Encoding, Prefix string
	// "seconds" or "milliseconds".
	TimestampUnit    string
	ToleranceSeconds int
}

var digitsOnly = regexp.MustCompile(`^\d{1,16}$`)

// SigningFrom is how Vapi signs, read from the VAPI_* settings: the
// webhook checks with it and the simulators sign with it, so they agree.
func SigningFrom(cfg config.Config) Signing {
	return Signing{Secret: cfg.VapiWebhookSecret, SignatureHeader: cfg.VapiSignatureHeader, TimestampHeader: cfg.VapiTimestampHeader,
		Algorithm: cfg.VapiSignatureAlgorithm, Payload: cfg.VapiSignaturePayload, Encoding: cfg.VapiSignatureEncoding,
		Prefix: cfg.VapiSignaturePrefix, TimestampUnit: cfg.VapiTimestampUnit, ToleranceSeconds: cfg.VapiToleranceSeconds}
}

// Valid: the signature matches these exact bytes (and, when the timestamp
// is signed, the request is recent: a captured one can't be replayed).
func (s Signing) Valid(body []byte, signature, timestamp string, now time.Time) bool {
	if s.Secret == "" || signature == "" || !strings.HasPrefix(signature, s.Prefix) {
		return false
	}
	signed := s.Payload == "{timestamp}.{body}"
	if signed && !s.recent(timestamp, now) {
		return false
	}
	expected := s.compute(body, timestamp)
	return hmac.Equal([]byte(expected), []byte(signature[len(s.Prefix):]))
}

// Headers are what Vapi would send for a body (the simulator and tests).
func (s Signing) Headers(body []byte, now time.Time) map[string]string {
	timestamp := strconv.FormatInt(now.Unix(), 10)
	if s.TimestampUnit == "milliseconds" {
		timestamp = strconv.FormatInt(now.UnixMilli(), 10)
	}
	return map[string]string{s.SignatureHeader: s.Prefix + s.compute(body, timestamp), s.TimestampHeader: timestamp}
}

func (s Signing) compute(body []byte, timestamp string) string {
	newHash := sha256.New
	switch s.Algorithm {
	case "sha512":
		newHash = sha512.New
	case "sha1":
		newHash = func() hash.Hash { return sha1.New() }
	}
	mac := hmac.New(newHash, []byte(s.Secret))
	if s.Payload == "{timestamp}.{body}" {
		mac.Write([]byte(timestamp + "."))
	}
	mac.Write(body)
	if s.Encoding == "base64" {
		return base64.StdEncoding.EncodeToString(mac.Sum(nil))
	}
	return hex.EncodeToString(mac.Sum(nil))
}

func (s Signing) recent(timestamp string, now time.Time) bool {
	if !digitsOnly.MatchString(timestamp) {
		return false
	}
	value, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return false
	}
	sent := time.Unix(value, 0)
	if s.TimestampUnit == "milliseconds" {
		sent = time.UnixMilli(value)
	}
	return now.Sub(sent).Abs() <= time.Duration(s.ToleranceSeconds)*time.Second
}
