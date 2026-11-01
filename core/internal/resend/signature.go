// Package resend is Resend's side of email (the old
// services/inbound-email-webhook.ts, services/inbound-email-routing.ts,
// lib/resend-webhook.ts and the receiving part of adapters/resend.ts): its
// signed webhook (received emails, and delivery problems of emails ansa
// sent) and fetching a received email's content. The company comes ONLY
// from a forwarding address ansa made.
package resend

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// signatureTolerance: an event older or newer than this is refused (Standard Webhooks).
const signatureTolerance = 5 * time.Minute

// IsSigned checks Resend's Standard Webhooks signature (svix): HMAC-SHA256
// with the secret ("whsec_" + base64) over "<id>.<timestamp>.<body>",
// base64, one of the space-separated "v1,<signature>" entries; compared in
// constant time; within 5 minutes.
func IsSigned(headers http.Header, body []byte, secret string, now time.Time) bool {
	key, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(secret, "whsec_"))
	if err != nil || len(key) == 0 {
		return false
	}
	id := firstOf(headers, "svix-id", "webhook-id")
	stamp := firstOf(headers, "svix-timestamp", "webhook-timestamp")
	signatures := firstOf(headers, "svix-signature", "webhook-signature")
	seconds, err := strconv.ParseInt(stamp, 10, 64)
	if id == "" || err != nil || signatures == "" {
		return false
	}
	if at := time.Unix(seconds, 0); now.Sub(at) > signatureTolerance || at.Sub(now) > signatureTolerance {
		return false
	}
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(id + "." + stamp + "."))
	mac.Write(body)
	expected := mac.Sum(nil)
	for _, entry := range strings.Fields(signatures) {
		version, signature, found := strings.Cut(entry, ",")
		given, err := base64.StdEncoding.DecodeString(signature)
		if found && version == "v1" && err == nil && hmac.Equal(given, expected) {
			return true
		}
	}
	return false
}

// Sign makes the headers Resend would send (the tests and the simulator use it).
func Sign(body []byte, id, secret string, at time.Time) http.Header {
	key, _ := base64.StdEncoding.DecodeString(strings.TrimPrefix(secret, "whsec_"))
	stamp := strconv.FormatInt(at.Unix(), 10)
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(id + "." + stamp + "."))
	mac.Write(body)
	headers := http.Header{}
	headers.Set("svix-id", id)
	headers.Set("svix-timestamp", stamp)
	headers.Set("svix-signature", "v1,"+base64.StdEncoding.EncodeToString(mac.Sum(nil)))
	return headers
}

func firstOf(headers http.Header, names ...string) string {
	for _, name := range names {
		if value := headers.Get(name); value != "" {
			return value
		}
	}
	return ""
}
