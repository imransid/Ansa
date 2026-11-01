package safefetch

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
)

func TestOnlyPublicAddressesArePublic(t *testing.T) {
	for text, want := range map[string]bool{
		"93.184.216.34": true, "2606:4700::1111": true,
		"10.1.2.3": false, "127.0.0.1": false, "169.254.169.254": false, "100.64.0.1": false, "192.168.1.1": false,
		"::1": false, "fe80::1": false, "fd00::1": false, "::ffff:10.0.0.1": false, "64:ff9b::7f00:1": false, "::ffff:93.184.216.34": true,
	} {
		if got := IsPublic(netip.MustParseAddr(text)); got != want {
			t.Errorf("%s: %v", text, got)
		}
	}
}

// world is a fake internet: every name resolves to what `names` says, and
// every connection goes to one TLS test server (whose certificate is for example.com).
func world(t *testing.T, names map[string]string, handler http.HandlerFunc) *Fetcher {
	server := httptest.NewTLSServer(handler)
	t.Cleanup(server.Close)
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	return &Fetcher{
		Resolve: func(_ context.Context, host string) ([]netip.Addr, error) {
			address, known := names[host]
			if !known {
				return nil, &net.DNSError{Err: "no such host", Name: host}
			}
			return []netip.Addr{netip.MustParseAddr(address)}, nil
		},
		Dial: func(ctx context.Context, address netip.AddrPort) (net.Conn, error) {
			if !IsPublic(address.Addr()) {
				t.Fatalf("dialed a private address: %s", address)
			}
			return (&net.Dialer{}).DialContext(ctx, "tcp", server.Listener.Addr().String())
		},
		TLS: &tls.Config{RootCAs: roots},
	}
}

func TestAPublicPageIsFetchedAndDecoded(t *testing.T) {
	fetcher := world(t, map[string]string{"example.com": "93.184.216.34"}, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/latin":
			w.Header().Set("Content-Type", "text/html; charset=windows-1252")
			w.Write([]byte("<title>Caf\xe9</title>"))
		case "/move":
			http.Redirect(w, r, "/latin", http.StatusFound)
		case "/image":
			w.Header().Set("Content-Type", "image/png")
		case "/big":
			w.Header().Set("Content-Type", "text/plain")
			w.Write([]byte(strings.Repeat("x", maxBytes+1)))
		}
	})
	page, code := fetcher.Fetch(context.Background(), "https://example.com/move")
	if code != "" || page.ContentType != "text/html" || page.Text != "<title>Café</title>" {
		t.Fatalf("page: %+v %s", page, code)
	}
	for path, want := range map[string]string{"/image": "wrong_type", "/big": "too_large"} {
		if _, code := fetcher.Fetch(context.Background(), "https://example.com"+path); code != want {
			t.Errorf("%s: %s", path, code)
		}
	}
}

func TestNothingPrivateIsEverReached(t *testing.T) {
	fetcher := world(t, map[string]string{"example.com": "93.184.216.34", "inside.example": "10.0.0.5"}, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/to-inside":
			http.Redirect(w, r, "https://inside.example/", http.StatusFound)
		case "/to-http":
			http.Redirect(w, r, "http://example.com/", http.StatusFound)
		case "/loop":
			http.Redirect(w, r, "/loop", http.StatusFound)
		}
		io.WriteString(w, "")
	})
	cases := map[string]string{
		"http://example.com/":           "not_https",
		"https://user:pw@example.com/":  "credentials_in_url",
		"https://example.com:8443/":     "port_not_allowed",
		"https://10.0.0.5/":             "private_address",
		"https://[::1]/":                "private_address",
		"https://inside.example/":       "private_address",
		"https://example.com/to-inside": "private_address",
		"https://example.com/to-http":   "not_https",
		"https://example.com/loop":      "too_many_redirects",
		"https://nobody.example/":       "dns_failed",
		"not a url":                     "invalid_url",
	}
	for address, want := range cases {
		if _, code := fetcher.Fetch(context.Background(), address); code != want {
			t.Errorf("%s: got %s, want %s", address, code, want)
		}
	}
}
