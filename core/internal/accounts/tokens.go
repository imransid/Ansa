package accounts

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"regexp"
	"strings"
	"time"

	"ansa/core/internal/addresses"
)

// newID is Better Auth's kind of id and token: n letters and digits (a-z,
// A-Z, 0-9), chosen at random.
func newID(n int) (string, error) {
	const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	out := make([]byte, n)
	for i := range out {
		index, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			return "", err
		}
		out[i] = alphabet[index.Int64()]
	}
	return string(out), nil
}

// A confirmation link works for one hour, as a reset link does.
const linkLifetime = time.Hour

// signupToken is the token of an email confirmation link: a JWT signed
// HS256 with BETTER_AUTH_SECRET holding the address, as Better Auth makes
// them (links made by either backend keep working).
func signupToken(email, secret string, now time.Time) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256"}`))
	payload, _ := json.Marshal(map[string]any{"email": strings.ToLower(email), "iat": now.Unix(), "exp": now.Add(linkLifetime).Unix()})
	unsigned := header + "." + base64.RawURLEncoding.EncodeToString(payload)
	return unsigned + "." + jwtSignature(unsigned, secret)
}

var jwtShape = regexp.MustCompile(`^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$`)

// emailOfSignupToken is the address a confirmation link's token names, or
// "" when it is forged, expired, not HS256, or not a plain signup token
// (one for changing an address carries updateTo or requestType: refused).
func emailOfSignupToken(token, secret string, now time.Time) string {
	if len(token) > 2000 || !jwtShape.MatchString(token) {
		return ""
	}
	parts := strings.Split(token, ".")
	if !hmac.Equal([]byte(jwtSignature(parts[0]+"."+parts[1], secret)), []byte(parts[2])) {
		return ""
	}
	var header struct {
		Alg string `json:"alg"`
	}
	headerJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil || json.Unmarshal(headerJSON, &header) != nil || header.Alg != "HS256" {
		return ""
	}
	var payload map[string]json.RawMessage
	payloadJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || json.Unmarshal(payloadJSON, &payload) != nil {
		return ""
	}
	if _, has := payload["updateTo"]; has {
		return ""
	}
	if _, has := payload["requestType"]; has {
		return ""
	}
	var email string
	var expires int64
	if json.Unmarshal(payload["email"], &email) != nil || json.Unmarshal(payload["exp"], &expires) != nil || now.Unix() >= expires {
		return ""
	}
	if address, problem := addresses.AccountEmail(email); problem != "" || address != email {
		return ""
	}
	return email
}

func jwtSignature(unsigned, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(unsigned))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// resetIdentifier is how Better Auth stores a reset link (storeIdentifier
// "hashed"): base64url, no padding, of SHA-256("reset-password:" + token).
func resetIdentifier(token string) string {
	sum := sha256.Sum256([]byte("reset-password:" + token))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

var resetTokenShape = regexp.MustCompile(`^[A-Za-z0-9]{24}$`)
