package files

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestTheDevelopmentFolderKeepsEveryKeyInside(t *testing.T) {
	store := &Store{DevFolder: t.TempDir()}
	ctx := context.Background()
	if err := store.Put(ctx, "documents/c1/d1.pdf", []byte("%PDF"), "application/pdf"); err != nil {
		t.Fatalf("put: %v", err)
	}
	data, found, err := store.Read(ctx, "documents/c1/d1.pdf")
	if err != nil || !found || string(data) != "%PDF" {
		t.Fatalf("read: %v %v", found, err)
	}
	for _, key := range []string{"../escape", "documents/../../x", "/abs", "Upper/x"} {
		if err := store.Put(ctx, key, []byte("x"), "text/plain"); err != ErrUnsafeKey {
			t.Errorf("%q: %v", key, err)
		}
	}
	store.Delete(ctx, "documents/c1/d1.pdf")
	if _, found, _ := store.Read(ctx, "documents/c1/d1.pdf"); found {
		t.Fatal("deleted")
	}
}

func TestR2GetsSignedRequestsAndLinks(t *testing.T) {
	var seen []string
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.Path+" "+r.Header.Get("x-amz-content-sha256")[:8]+" "+strings.SplitN(r.Header.Get("Authorization"), " ", 2)[0])
		if r.Method == http.MethodGet {
			io.WriteString(w, "bytes")
		}
	}))
	defer server.Close()
	client := server.Client()
	store := &Store{R2: &R2{AccountID: "acct", AccessKeyID: "key", SecretAccessKey: "secret", Bucket: "ansa-files"}, Client: &http.Client{Transport: rewriteTo(server.URL, client.Transport)}}
	ctx := context.Background()
	if err := store.Put(ctx, "media/c1/a1.png", []byte("png"), "image/png"); err != nil {
		t.Fatalf("put: %v", err)
	}
	if data, found, err := store.Read(ctx, "media/c1/a1.png"); err != nil || !found || string(data) != "bytes" {
		t.Fatalf("read: %v", err)
	}
	if len(seen) != 2 || seen[0] != "PUT /ansa-files/media/c1/a1.png 8f8cbb7d AWS4-HMAC-SHA256" {
		t.Fatalf("requests: %v", seen)
	}
	access, _, _ := store.Reach(ctx, "documents/c1/d1.pdf", "application/pdf", 300, "Menu (2).pdf")
	if !strings.HasPrefix(access.SignedURL, "https://acct.r2.cloudflarestorage.com/ansa-files/documents/c1/d1.pdf?") ||
		!strings.Contains(access.SignedURL, "X-Amz-Expires=300") || !strings.Contains(access.SignedURL, "response-content-type=application%2Fpdf") {
		t.Fatalf("link: %s", access.SignedURL)
	}
}

// rewriteTo sends every request to the test server, whatever its host.
func rewriteTo(target string, next http.RoundTripper) http.RoundTripper {
	return roundTrip(func(r *http.Request) (*http.Response, error) {
		r.URL.Host = strings.TrimPrefix(target, "https://")
		return next.RoundTrip(r)
	})
}

type roundTrip func(*http.Request) (*http.Response, error)

func (f roundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
