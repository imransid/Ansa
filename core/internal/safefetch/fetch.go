// Package safefetch fetches a web page someone typed the address of
// ("Import a web page"), without letting that address reach anything
// private (SSRF), as the old lib/safe-fetch.ts: https on the default port
// only, no user name or password, no cookies or credentials sent, and only a
// host whose EVERY address is public. The host is resolved here, once, and
// the connection goes to exactly an address that was checked, so a DNS
// answer that changes in between (DNS rebinding) can't swap in a private
// one. Every redirect (at most 3) is checked the same way. 10 seconds in
// all, 2 MB at most, text/html or text/plain only, never compressed. Never
// logs: the caller logs the error code.
package safefetch

import (
	"context"
	"crypto/tls"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"golang.org/x/text/encoding/htmlindex"
)

// Fetcher fetches pages. The zero value uses the network; only the tests
// replace Resolve and Dial (they never touch the network).
type Fetcher struct {
	Resolve func(ctx context.Context, host string) ([]netip.Addr, error)
	Dial    func(ctx context.Context, address netip.AddrPort) (net.Conn, error)
	// Only the tests set it (their server's certificate).
	TLS *tls.Config
}

// Page is a fetched page's text and type ("text/html" or "text/plain").
type Page struct {
	ContentType, Text string
}

const (
	maxBytes     = 2 << 20
	timeout      = 10 * time.Second
	maxRedirects = 3
)

// Fetch fetches one page, or gives why not as a code: invalid_url,
// not_https, port_not_allowed, credentials_in_url, private_address,
// dns_failed, too_many_redirects, bad_redirect, http_status, wrong_type,
// unsupported_encoding, too_large, timeout, network_error.
func (f *Fetcher) Fetch(ctx context.Context, raw string) (Page, string) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	target, code := parse(raw)
	for redirects := 0; ; redirects++ {
		if code != "" {
			return Page{}, code
		}
		var addresses []netip.Addr
		addresses, code = f.publicAddresses(ctx, target.Hostname())
		if code != "" {
			return Page{}, code
		}
		response, err := f.client(addresses).Do(newRequest(ctx, target))
		if err != nil {
			if ctx.Err() != nil {
				return Page{}, "timeout"
			}
			return Page{}, "network_error"
		}
		switch response.StatusCode {
		case 301, 302, 303, 307, 308:
			response.Body.Close()
			if redirects >= maxRedirects {
				return Page{}, "too_many_redirects"
			}
			target, code = redirectTarget(response.Header.Get("Location"), target)
			continue
		}
		var page Page
		page, code = readAnswer(response)
		response.Body.Close()
		if code == "network_error" && ctx.Err() != nil {
			code = "timeout"
		}
		return page, code
	}
}

// parse: the address if it may be fetched at all (the host is checked next).
func parse(raw string) (*url.URL, string) {
	target, err := url.Parse(raw)
	switch {
	case err != nil || target.Host == "":
		return nil, "invalid_url"
	case target.Scheme != "https":
		return nil, "not_https"
	case target.User != nil:
		return nil, "credentials_in_url"
	case target.Port() != "":
		return nil, "port_not_allowed"
	case target.Hostname() == "":
		return nil, "invalid_url"
	}
	return target, ""
}

func redirectTarget(location string, from *url.URL) (*url.URL, string) {
	if location == "" {
		return nil, "bad_redirect"
	}
	next, err := from.Parse(location)
	if err != nil {
		return nil, "bad_redirect"
	}
	return parse(next.String())
}

// publicAddresses are every address of the host, when all are public. An
// address typed as the host is checked as it is: no lookup.
func (f *Fetcher) publicAddresses(ctx context.Context, host string) ([]netip.Addr, string) {
	var addresses []netip.Addr
	if literal, err := netip.ParseAddr(host); err == nil {
		addresses = []netip.Addr{literal}
	} else {
		resolve := f.Resolve
		if resolve == nil {
			resolve = func(ctx context.Context, host string) ([]netip.Addr, error) {
				return net.DefaultResolver.LookupNetIP(ctx, "ip", host)
			}
		}
		found, err := resolve(ctx, host)
		if ctx.Err() != nil {
			return nil, "timeout"
		}
		if err != nil || len(found) == 0 {
			return nil, "dns_failed"
		}
		addresses = found
	}
	for _, address := range addresses {
		if !IsPublic(address) {
			return nil, "private_address"
		}
	}
	return addresses, ""
}

// client connects only to the checked addresses (the first that answers),
// verifies the certificate for the host, sends no cookies, follows no
// redirect itself and asks for no compression.
func (f *Fetcher) client(addresses []netip.Addr) *http.Client {
	dial := f.Dial
	if dial == nil {
		dialer := &net.Dialer{}
		dial = func(ctx context.Context, address netip.AddrPort) (net.Conn, error) {
			return dialer.DialContext(ctx, "tcp", address.String())
		}
	}
	transport := &http.Transport{
		Proxy:              nil,
		DisableCompression: true,
		DisableKeepAlives:  true,
		TLSClientConfig:    f.TLS,
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			var last error
			for _, address := range addresses {
				conn, err := dial(ctx, netip.AddrPortFrom(address, 443))
				if err == nil {
					return conn, nil
				}
				last = err
			}
			return nil, last
		},
	}
	return &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func newRequest(ctx context.Context, target *url.URL) *http.Request {
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	request.Header.Set("Accept", "text/html, text/plain")
	request.Header.Set("Accept-Encoding", "identity")
	return request
}

// readAnswer takes a final answer's text: 2xx, text/html or text/plain, not
// compressed, at most 2 MB (reading stops there), decoded with the charset
// its server names, else UTF-8.
func readAnswer(response *http.Response) (Page, string) {
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return Page{}, "http_status"
	}
	mediaType, parameters, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
	mediaType = strings.ToLower(mediaType)
	if mediaType != "text/html" && mediaType != "text/plain" {
		return Page{}, "wrong_type"
	}
	if encoding := strings.ToLower(strings.TrimSpace(response.Header.Get("Content-Encoding"))); encoding != "" && encoding != "identity" {
		return Page{}, "unsupported_encoding"
	}
	if response.ContentLength > maxBytes {
		return Page{}, "too_large"
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
	switch {
	case err != nil:
		return Page{}, "network_error"
	case len(data) > maxBytes:
		return Page{}, "too_large"
	}
	return Page{ContentType: mediaType, Text: decode(data, parameters["charset"])}, ""
}

func decode(data []byte, charset string) string {
	if charset != "" {
		if encoding, err := htmlindex.Get(charset); err == nil {
			if text, err := encoding.NewDecoder().Bytes(data); err == nil {
				return string(text)
			}
		}
	}
	return strings.ToValidUTF8(string(data), "�")
}
