package knowledge

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

	"ansa/core/internal/database"
	"ansa/core/internal/safefetch"
	"ansa/core/internal/tenant"
)

// fakeWeb is a fake internet: every name is a public address, and every
// connection goes to one TLS test server (its certificate is for
// example.com). No test touches the network.
func fakeWeb(t *testing.T, handler http.HandlerFunc) *safefetch.Fetcher {
	server := httptest.NewTLSServer(handler)
	t.Cleanup(server.Close)
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	return &safefetch.Fetcher{
		Resolve: func(context.Context, string) ([]netip.Addr, error) {
			return []netip.Addr{netip.MustParseAddr("93.184.216.34")}, nil
		},
		Dial: func(ctx context.Context, _ netip.AddrPort) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "tcp", server.Listener.Addr().String())
		},
		TLS: &tls.Config{RootCAs: roots},
	}
}

// A browser's type="url" box takes "Https://": the page is saved under the
// address as it was fetched, which the column's CHECK accepts.
func TestAnAddressTypedWithACapitalInItsSchemeIsImported(t *testing.T) {
	pool := database.ForTest(t)
	ctx := context.Background()
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	owner := database.TestOwner(t, pool, companyID)
	fetcher := fakeWeb(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		io.WriteString(w, "<title>Parking</title><p>Parking is free after 6pm.</p>")
	})
	created, _, code, problem, err := ImportWebPage(ctx, pool, fetcher, company, owner, "Https://example.com/faq")
	if err != nil || code != "" || problem != "" || created != 1 {
		t.Fatalf("import: %d %q %q %v", created, code, problem, err)
	}
	var title, source string
	err = pool.QueryRow(ctx, `SELECT title, source_url FROM knowledge_articles WHERE company_id = $1`, companyID).Scan(&title, &source)
	if err != nil || title != "Parking" || source != "https://example.com/faq" {
		t.Fatalf("saved: %q %q %v", title, source, err)
	}
}

// The address is saved written out in full, which can be longer than what
// was typed: one over the column's 2,000 characters is refused before
// anything is fetched.
func TestAnAddressTooLongWrittenOutIsRefusedBeforeItIsFetched(t *testing.T) {
	fetcher := fakeWeb(t, func(http.ResponseWriter, *http.Request) {
		t.Error("the page was fetched")
	})
	// 2,000 bytes as typed; each "ü" is written out as "%C3%BC".
	typed := "https://example.com/" + strings.Repeat("ü", 990)
	_, _, code, problem, err := ImportWebPage(context.Background(), nil, fetcher, tenant.CompanyID{}, "", typed)
	if code != "address_too_long" || FetchProblems[code] == "" || problem != "" || err != nil {
		t.Fatalf("got %q %q %v", code, problem, err)
	}
}
