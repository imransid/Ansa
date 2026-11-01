package social

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/platforms"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// With any setting of ansa's real platform apps set, these tests refuse to
// run, and the network itself is refused: they must never reach a real
// platform (the old checks' local-only guard).
func TestMain(m *testing.M) {
	for _, name := range []string{"LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "X_CLIENT_ID", "X_CLIENT_SECRET",
		"GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"} {
		if os.Getenv(name) != "" {
			fmt.Println("social: tests refuse to run with " + name + " set (they must never reach a real platform)")
			os.Exit(1)
		}
	}
	http.DefaultTransport = fakePlatform{}
	os.Exit(m.Run())
}

// fakePlatform answers requests in order with its answers and counts them.
type fakePlatform struct {
	mu       *sync.Mutex
	answers  *[]func(*http.Request) (*http.Response, error)
	received *[]string
}

func fake(answers ...func(*http.Request) (*http.Response, error)) fakePlatform {
	return fakePlatform{mu: &sync.Mutex{}, answers: &answers, received: &[]string{}}
}

func (f fakePlatform) RoundTrip(r *http.Request) (*http.Response, error) {
	if f.mu == nil {
		return nil, errors.New("tests never reach the network")
	}
	var body []byte
	if r.Body != nil {
		body, _ = io.ReadAll(r.Body)
	}
	f.mu.Lock()
	*f.received = append(*f.received, r.URL.String()+" "+string(body))
	var next func(*http.Request) (*http.Response, error)
	if len(*f.answers) > 0 {
		next, *f.answers = (*f.answers)[0], (*f.answers)[1:]
	}
	f.mu.Unlock()
	if next == nil {
		return nil, errors.New("the fake platform has no answer left")
	}
	return next(r)
}

func (f fakePlatform) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(*f.received)
}

func reply(status int, body string) func(*http.Request) (*http.Response, error) {
	return func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: status, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	}
}

// renewedTo is a token endpoint renewing to "<name>-access" for two hours,
// with a new refresh token "<name>-refresh".
func renewedTo(name string) func(*http.Request) (*http.Response, error) {
	return reply(200, `{"token_type":"bearer","expires_in":7200,"access_token":"`+name+`-access","refresh_token":"`+name+`-refresh"}`)
}

// world is one test company with an owner, and a Renewer whose platforms
// answer through a fake.
type world struct {
	t       *testing.T
	pool    *database.Pool
	box     *secure.Box
	company tenant.CompanyID
	owner   string
}

func newWorld(t *testing.T) *world {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	box, _ := secure.NewBox("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	return &world{t: t, pool: pool, box: box, company: company, owner: database.TestOwner(t, pool, companyID)}
}

// renewer is a Renewer whose platforms have ansa's apps and answer through f.
func (w *world) renewer(f fakePlatform) *Renewer {
	apps := map[string]platforms.App{"linkedin": {ClientID: "li", ClientSecret: "li-s"}, "x": {ClientID: "x", ClientSecret: "x-s"}, "youtube": {ClientID: "g", ClientSecret: "g-s"}}
	return &Renewer{Pool: w.pool, Box: w.box, Platforms: &platforms.Connectors{Apps: apps, Transport: f},
		Wait: func(context.Context, time.Duration) error {
			return errors.New("a run waited where no other run was renewing")
		}}
}

// connect saves a connection of the company with its tokens encrypted for
// its id ("<platform>-access", "<platform>-refresh" when withRefresh),
// running out in expiresIn (0 = never).
func (w *world) connect(platform, externalID string, expiresIn time.Duration, withRefresh bool) string {
	ctx := context.Background()
	var id string
	w.pool.QueryRow(ctx, `SELECT gen_random_uuid()::text`).Scan(&id)
	access, _ := w.box.Encrypt(platform+"-access", TokenContext(w.company, id, "access"))
	var refresh *string
	if withRefresh {
		encrypted, _ := w.box.Encrypt(platform+"-refresh", TokenContext(w.company, id, "refresh"))
		refresh = &encrypted
	}
	var expires *time.Time
	if expiresIn != 0 {
		at := time.Now().Add(expiresIn)
		expires = &at
	}
	const insert = `
		INSERT INTO social_connections (id, company_id, platform, external_account_id, display_name, account_kind, scopes,
			access_token_encrypted, refresh_token_encrypted, access_expires_at, refresh_expires_at, status, connected_by_user_id, is_stand_in)
		VALUES ($1, $2, $3, $4, 'Test account', $5, '{}', $6, $7, $8, NULL, 'connected', $9, $4 = 'dev:stand-in')`
	if _, err := w.pool.Exec(ctx, insert, id, w.company.String(), platform, externalID, platforms.AccountKinds[platform], access, refresh, expires, w.owner); err != nil {
		w.t.Fatalf("saving a connection: %v", err)
	}
	return id
}

// row is a connection as stored, its tokens decrypted ("" when none or unreadable).
type row struct {
	status, lastError, access, refresh string
	renewalClaimed                     bool
	accessExpiresAt                    *time.Time
}

func (w *world) row(id string) row {
	var r row
	var lastError, access, refresh *string
	err := w.pool.QueryRow(context.Background(), `
		SELECT status, last_error, access_token_encrypted, refresh_token_encrypted, renewal_started_at IS NOT NULL, access_expires_at
		FROM social_connections WHERE company_id = $1 AND id = $2`, w.company.String(), id).Scan(&r.status, &lastError, &access, &refresh, &r.renewalClaimed, &r.accessExpiresAt)
	if err != nil {
		w.t.Fatalf("reading the connection: %v", err)
	}
	if lastError != nil {
		r.lastError = *lastError
	}
	if access != nil {
		r.access, _ = w.box.Decrypt(*access, TokenContext(w.company, id, "access"))
	}
	if refresh != nil {
		r.refresh, _ = w.box.Decrypt(*refresh, TokenContext(w.company, id, "refresh"))
	}
	return r
}

func (w *world) must(statement string, args ...any) {
	if _, err := w.pool.Exec(context.Background(), statement, args...); err != nil {
		w.t.Fatalf("setup: %v", err)
	}
}

func check(t *testing.T, what string, got, want any) {
	t.Helper()
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("%s:\n got %v\nwant %v", what, got, want)
	}
}
