// Package download fetches a file from an address an outside service
// handed core (a call recording in a signed Vapi webhook; later an image
// service's result), as the old lib/allowed-host-download.ts: the server
// fetching an address it was handed is a classic attack (SSRF), so every
// address, every redirect included, must be https on an exact allowed host,
// the default port, no user name or password. One time limit for the whole
// download. The address is never logged.
package download

import (
	"context"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Rules for one download.
type Rules struct {
	// Exact host names, lower-case.
	AllowedHosts []string
	MaxBytes     int64
	// Accepts says whether a Content-Type (without parameters, lower-case) may be kept.
	Accepts func(contentType string) bool
	Timeout time.Duration
}

const maxRedirects = 3

// Client is replaced by the tests.
var Client = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

// Allowed says whether an address may be fetched at all.
func Allowed(raw string, hosts []string) bool {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || (parsed.Port() != "" && parsed.Port() != "443") {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	for _, allowed := range hosts {
		if host == allowed {
			return true
		}
	}
	return false
}

// Fetch downloads a file: its bytes and type; tooLarge when it is (by its
// stated length, or while it arrives); ok=false for any other broken rule
// (a bad address or redirect, a type it doesn't accept, a server error).
func Fetch(ctx context.Context, raw string, rules Rules) (data []byte, contentType string, tooLarge, ok bool) {
	ctx, cancel := context.WithTimeout(ctx, rules.Timeout)
	defer cancel()
	current := raw
	for hop := 0; hop <= maxRedirects; hop++ {
		if !Allowed(current, rules.AllowedHosts) {
			return nil, "", false, false
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, current, nil)
		if err != nil {
			return nil, "", false, false
		}
		response, err := Client.Do(request)
		if err != nil {
			return nil, "", false, false
		}
		if response.StatusCode >= 300 && response.StatusCode < 400 {
			location := response.Header.Get("Location")
			response.Body.Close()
			next, err := request.URL.Parse(location)
			if location == "" || err != nil {
				return nil, "", false, false
			}
			current = next.String()
			continue
		}
		defer response.Body.Close()
		if response.StatusCode/100 != 2 {
			return nil, "", false, false
		}
		mediaType, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
		contentType = strings.ToLower(mediaType)
		if !rules.Accepts(contentType) {
			return nil, "", false, false
		}
		if response.ContentLength > rules.MaxBytes {
			return nil, "", true, false
		}
		data, err = io.ReadAll(io.LimitReader(response.Body, rules.MaxBytes+1))
		if err != nil {
			return nil, "", false, false
		}
		if int64(len(data)) > rules.MaxBytes {
			return nil, "", true, false
		}
		return data, contentType, false, true
	}
	return nil, "", false, false
}
