package socialconnect

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/messenger"
	"ansa/core/internal/secure"
	"ansa/core/internal/social"
	"ansa/core/internal/tenant"
)

// fakeGraph answers Facebook's login calls; granted are the permissions the
// person left ticked.
// subscribedFields is what the fake Graph API was last asked to send ansa.
var subscribedFields string

func fakeGraph(t *testing.T, granted []string, subscribed *int) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/oauth/access_token" && r.URL.Query().Get("code") == "good-code":
			io.WriteString(w, `{"access_token":"short"}`)
		case r.URL.Path == "/oauth/access_token" && r.URL.Query().Get("fb_exchange_token") == "short":
			io.WriteString(w, `{"access_token":"long"}`)
		case r.URL.Path == "/me/permissions" && r.URL.Query().Get("appsecret_proof") == messenger.AppSecretProof("long", "app-secret"):
			var entries []string
			for _, permission := range granted {
				entries = append(entries, `{"permission":"`+permission+`","status":"granted"}`)
			}
			io.WriteString(w, `{"data":[`+strings.Join(entries, ",")+`]}`)
		case r.URL.Path == "/me/accounts":
			io.WriteString(w, `{"data":[{"id":"111","name":"Luigi's\nPizza","access_token":"page-token","tasks":["CREATE_CONTENT"]},{"id":"222","name":"Not mine","access_token":"x","tasks":["ANALYZE"]}]}`)
		case r.URL.Path == "/111/subscribed_apps" && r.Method == http.MethodPost:
			*subscribed++
			r.ParseForm()
			subscribedFields = r.PostForm.Get("subscribed_fields")
			io.WriteString(w, `{"success":true}`)
		default:
			w.WriteHeader(http.StatusBadRequest)
			io.WriteString(w, `{"error":{"code":100}}`)
		}
	}))
	t.Cleanup(server.Close)
	before := messenger.GraphURL
	messenger.GraphURL = server.URL
	t.Cleanup(func() { messenger.GraphURL = before })
}

func newConnector(t *testing.T) (*Connector, tenant.CompanyID, string) {
	pool := database.ForTest(t)
	companyID := database.TestCompany(t, pool)
	company, _ := tenant.FromTrustedSource(companyID)
	owner := database.TestOwner(t, pool, companyID)
	box, _ := secure.NewBox("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=")
	return &Connector{Pool: pool, Box: box, Log: logging.New(io.Discard), AppID: "app-id", AppSecret: "app-secret", AppURL: "https://ansa.test"}, company, owner
}

func stateOf(t *testing.T, address string) string {
	parsed, err := url.Parse(address)
	if err != nil || !strings.HasPrefix(address, DialogURL) {
		t.Fatalf("consent screen: %s", address)
	}
	if parsed.Query().Get("redirect_uri") != "https://ansa.test/api/social/facebook/callback" || !strings.Contains(parsed.Query().Get("scope"), "pages_messaging") ||
		!strings.Contains(parsed.Query().Get("scope"), "pages_read_user_content,pages_manage_engagement") {
		t.Fatalf("redirect and scopes: %s", address)
	}
	return parsed.Query().Get("state")
}

func TestAnOwnersLoginConnectsTheirPagesOnceWithEncryptedTokens(t *testing.T) {
	subscribed := 0
	fakeGraph(t, allScopes, &subscribed)
	c, company, owner := newConnector(t)
	ctx := context.Background()
	address, outcome, err := c.Start(ctx, company, owner, "facebook")
	if err != nil || outcome != "started" {
		t.Fatalf("start: %s %v", outcome, err)
	}
	state := stateOf(t, address)
	if result, _, _ := c.Complete(ctx, company, owner, true, "facebook", url.Values{"state": {"made-up"}, "code": {"good-code"}}); result != "expired_state" {
		t.Fatalf("a state nobody started: %s", result)
	}
	result, count, err := c.Complete(ctx, company, owner, true, "facebook", url.Values{"state": {state}, "code": {"good-code"}})
	if err != nil || result != "connected" || count != 1 || subscribed != 1 {
		t.Fatalf("connected: %s %d %v (subscribed %d)", result, count, err, subscribed)
	}
	if subscribedFields != "messages,message_echoes,feed" {
		t.Fatalf("the Page's messages and its comments (feed) come to ansa: %q", subscribedFields)
	}
	if again, _, _ := c.Complete(ctx, company, owner, true, "facebook", url.Values{"state": {state}, "code": {"good-code"}}); again != "expired_state" {
		t.Fatal("a state works once")
	}
	var id, name, stored string
	c.Pool.QueryRow(ctx, `SELECT id, display_name, access_token_encrypted FROM social_connections WHERE company_id = $1 AND external_account_id = '111'`, company.String()).Scan(&id, &name, &stored)
	if name != "Luigi's Pizza" || strings.Contains(stored, "page-token") {
		t.Fatalf("one plain name, the token encrypted: %q", name)
	}
	if token, err := social.PageToken(ctx, c.Pool, c.Box, company, id); err != nil || token != "page-token" {
		t.Fatalf("the Page's token, read for its connection: %v", err)
	}
	if outcome, _, _ := Disconnect(ctx, c.Pool, company, owner, id); outcome != "disconnected" {
		t.Fatalf("disconnect: %s", outcome)
	}
	var status string
	var left *string
	c.Pool.QueryRow(ctx, `SELECT status, access_token_encrypted FROM social_connections WHERE company_id = $1 AND id = $2`, company.String(), id).Scan(&status, &left)
	if status != "disconnected" || left != nil {
		t.Fatal("the token is gone, the row stays")
	}
}

func TestAnUntickedPostingPermissionOrADenialConnectsNothing(t *testing.T) {
	subscribed := 0
	fakeGraph(t, []string{"pages_show_list", "pages_read_engagement"}, &subscribed)
	c, company, owner := newConnector(t)
	ctx := context.Background()
	address, _, _ := c.Start(ctx, company, owner, "facebook")
	if result, _, _ := c.Complete(ctx, company, owner, true, "facebook", url.Values{"state": {stateOf(t, address)}, "code": {"good-code"}}); result != "missing_permission" {
		t.Fatalf("missing permission: %s", result)
	}
	address, _, _ = c.Start(ctx, company, owner, "facebook")
	if result, _, _ := c.Complete(ctx, company, owner, true, "facebook", url.Values{"state": {stateOf(t, address)}, "error": {"access_denied"}}); result != "denied" {
		t.Fatalf("denied: %s", result)
	}
	address, _, _ = c.Start(ctx, company, owner, "facebook")
	if result, _, _ := c.Complete(ctx, company, owner, false, "facebook", url.Values{"state": {stateOf(t, address)}, "code": {"good-code"}}); result != "not_owner" {
		t.Fatalf("made a member meanwhile: %s", result)
	}
	var connections int
	c.Pool.QueryRow(ctx, `SELECT count(*) FROM social_connections WHERE company_id = $1`, company.String()).Scan(&connections)
	if connections != 0 {
		t.Fatal("nothing connected")
	}
}

func TestTheStandInConnectsOnlyInDevelopmentWithoutTheApp(t *testing.T) {
	c, company, owner := newConnector(t)
	ctx := context.Background()
	if outcome, _ := c.ConnectStandIn(ctx, company, owner, "facebook"); outcome != "not-set-up" {
		t.Fatal("with ansa's Meta app, no stand-in")
	}
	c.AppID, c.AppSecret, c.Development = "", "", true
	if _, outcome, _ := c.Start(ctx, company, owner, "facebook"); outcome != "not-set-up" {
		t.Fatal("no app: no consent screen")
	}
	if outcome, err := c.ConnectStandIn(ctx, company, owner, "facebook"); err != nil || outcome != "connected" {
		t.Fatalf("stand-in: %s %v", outcome, err)
	}
	if outcome, _ := c.ConnectStandIn(ctx, company, owner, "facebook"); outcome != "connected" {
		t.Fatal("connecting it again renews it")
	}
	var standIns int
	c.Pool.QueryRow(ctx, `SELECT count(*) FROM social_connections WHERE company_id = $1 AND is_stand_in AND status = 'connected'`, company.String()).Scan(&standIns)
	if standIns != 1 {
		t.Fatalf("one stand-in Page: %d", standIns)
	}
	c.Development = false
	if c.Mode("facebook") != "not-set-up" {
		t.Fatal("production without the app: not set up")
	}
}

// A Page's webhooks follow what the person allowed: messages with the
// messaging permissions, its feed (comments) with both comment ones, and
// nothing without pages_manage_metadata (subscribing itself needs it).
func TestThePagesWebhooksFollowWhatWasAllowed(t *testing.T) {
	for _, c := range []struct {
		scopes []string
		want   string
	}{
		{allScopes, "messages,message_echoes,feed"},
		{append(append([]string{}, postingScopes...), messagingScopes...), "messages,message_echoes"},
		{append(append([]string{"pages_manage_metadata"}, postingScopes...), commentScopes...), "feed"},
		{append(append([]string{}, postingScopes...), commentScopes...), ""},
		{append([]string{"pages_manage_metadata", "pages_read_user_content"}, postingScopes...), ""},
	} {
		if got := strings.Join(webhookFields(c.scopes), ","); got != c.want {
			t.Errorf("%v: %q, want %q", c.scopes, got, c.want)
		}
	}
}
