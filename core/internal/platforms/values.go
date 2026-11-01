package platforms

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf16"

	"ansa/core/internal/plaintext"
)

// Reading what a platform answered: whole numbers, lifetimes, scopes, an
// account's name, how long to wait.

// whole is a JSON number that must be a whole number (never null, a
// string or 2.5); set says whether the answer had it.
type whole struct {
	value int64
	set   bool
}

func (w *whole) UnmarshalJSON(data []byte) error {
	var number float64
	if string(data) == "null" || json.Unmarshal(data, &number) != nil || number != math.Trunc(number) || math.Abs(number) > 1<<53 {
		return errors.New("platforms: not a whole number")
	}
	w.value, w.set = int64(number), true
	return nil
}

// expiryFrom is when a token runs out, from its expires_in (seconds); nil
// when the platform said nothing.
func expiryFrom(seconds whole, now time.Time) *time.Time {
	if !seconds.set {
		return nil
	}
	at := now.Add(time.Duration(seconds.value) * time.Second)
	return &at
}

var scopeSeparator = regexp.MustCompile(`[\s,]+`)

// grantedScopes are the permissions a token answer names ("a b" or "a,b"),
// or what ansa asked for when it names none; each once, at most 50.
func grantedScopes(scope string, asked []string) []string {
	named := []string{}
	for _, part := range scopeSeparator.Split(scope, -1) {
		if part != "" {
			named = append(named, part)
		}
	}
	if len(named) == 0 {
		named = asked
	}
	scopes := []string{}
	for _, name := range named {
		if !contains(scopes, name) && len(scopes) < 50 {
			scopes = append(scopes, name)
		}
	}
	return scopes
}

// accountName is an account's name as one plain line of at most 200
// characters (as the old cutToLength counted them), else the fallback.
func accountName(name, fallback string) string {
	line := plaintext.SingleLine(name)
	units := 0
	for index, r := range line {
		units += utf16.RuneLen(r)
		if units > 200 {
			line = strings.TrimRightFunc(line[:index], func(r rune) bool { return unicode.IsSpace(r) || r == 0xFEFF })
			break
		}
	}
	if line == "" {
		return fallback
	}
	return line
}

// utf16Length counts a text as the old code's limits did (JavaScript's length).
func utf16Length(text string) int {
	units := 0
	for _, r := range text {
		units += utf16.RuneLen(r)
	}
	return units
}

var digitsOnly = regexp.MustCompile(`^\d+$`)

// secondsFromRetryAfter reads a Retry-After header (seconds, or an HTTP
// date): seconds to wait, 0 = not said.
func secondsFromRetryAfter(value string, now time.Time) int {
	value = strings.TrimSpace(value)
	if digitsOnly.MatchString(value) {
		seconds, err := strconv.Atoi(value)
		if err != nil {
			return 0
		}
		return seconds
	}
	at, err := http.ParseTime(value)
	if err != nil || !at.After(now) {
		return 0
	}
	return int(math.Ceil(at.Sub(now).Seconds()))
}

// secondsUntilEpochSeconds reads X's x-rate-limit-reset (seconds since
// 1970): seconds until then, at least 1; 0 = not said.
func secondsUntilEpochSeconds(value string, now time.Time) int {
	value = strings.TrimSpace(value)
	if !digitsOnly.MatchString(value) {
		return 0
	}
	reset, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0
	}
	seconds := reset - float64(now.UnixMilli())/1000
	if seconds <= 0 {
		return 1
	}
	return int(math.Ceil(seconds))
}

func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}
