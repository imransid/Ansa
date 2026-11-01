// Package httpserver builds core's HTTP server with the protections every
// route gets: time limits (so a slow client can't hold a connection), security
// headers, a recovered panic answered 500 with one safe log line, and a size
// cap helper for request bodies (docs/backend/security.md, rule 4).
package httpserver

import (
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"ansa/core/internal/logging"
)

// New returns a server for these routes with safe time limits.
func New(addr string, routes http.Handler, log *logging.Logger) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           withProtections(routes, log),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		// Long enough for a webhook's answer; slow work runs as a job after it.
		WriteTimeout:   30 * time.Second,
		IdleTimeout:    60 * time.Second,
		MaxHeaderBytes: 64 << 10,
	}
}

func withProtections(next http.Handler, log *logging.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		headers := w.Header()
		headers.Set("X-Content-Type-Options", "nosniff")
		headers.Set("X-Frame-Options", "DENY")
		headers.Set("Referrer-Policy", "no-referrer")
		headers.Set("Cache-Control", "no-store")
		defer func() {
			if recovered := recover(); recovered != nil {
				log.Error("request panicked", logging.Code("panic"))
				w.WriteHeader(http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// ErrTooLarge means a request body was over its cap (answer 413).
var ErrTooLarge = errors.New("request body too large")

// ReadBody reads at most maxBytes of the body: the raw bytes a signature is
// checked on, before anything is parsed.
func ReadBody(r *http.Request, maxBytes int64) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > maxBytes {
		return nil, ErrTooLarge
	}
	return body, nil
}

// Health answers 200 with no body: the uptime monitor's check. The database
// check joins it with the database module.
func Health(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
}

// ClientIP is the caller's address as the key for per-IP rate limits (its
// only use), the same as the old lib/request-ip.ts so both backends count
// together: X-Forwarded-For's first entry (only trustworthy behind a host
// that overwrites it), else X-Real-IP, else the connection's own address. An
// IPv6 address counts as its /64 network ("2001:db8:1:2::/64"): whoever has
// one IPv6 connection usually has a whole /64, endless fresh counters.
func ClientIP(r *http.Request) string {
	return rateLimitAddress(clientAddress(r))
}

func clientAddress(r *http.Request) string {
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		first, _, _ := strings.Cut(forwarded, ",")
		return strings.TrimSpace(first)
	}
	if real := r.Header.Get("X-Real-IP"); real != "" {
		return real
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

func rateLimitAddress(address string) string {
	// "fe80::1%eth0": the part after "%" only names a network card.
	withoutZone, _, _ := strings.Cut(address, "%")
	ip, err := netip.ParseAddr(withoutZone)
	if err != nil || !ip.Is6() {
		return address
	}
	bytes := ip.As16()
	groups := make([]string, 4)
	allZero := true
	for i := range groups {
		value := uint16(bytes[2*i])<<8 | uint16(bytes[2*i+1])
		groups[i] = strconv.FormatUint(uint64(value), 16)
		allZero = allZero && value == 0
	}
	// ::/64 holds loopback and IPv4 written as IPv6: not one person's network.
	if allZero {
		return strings.ToLower(withoutZone)
	}
	return strings.Join(groups, ":") + "::/64"
}
