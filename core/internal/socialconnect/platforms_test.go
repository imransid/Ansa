package socialconnect

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"net/url"
	"strings"
	"testing"
	"time"

	"ansa/core/internal/database"
	"ansa/core/internal/social"
	"ansa/core/internal/tenant"
)

func TestConnectSavesOnlyTheStatesHashAndPKCEWhereThePlatformHasIt(t *testing.T) {
	c, company, owner := newConnector(t)
	withPlatforms(c, &fakePlatform{})
	ctx := context.Background()
	for _, platform := range []string{"linkedin", "x", "youtube"} {
		address, outcome, err := c.Start(ctx, company, owner, platform)
		if err != nil || outcome != "started" {
			t.Fatalf("%s: %s %v", platform, outcome, err)
		}
		query := queryOf(t, address)
		state := query.Get("state")
		check(t, platform+": 32 random bytes", len(state), 43)
		if query.Get("redirect_uri") != "https://ansa.test/api/social/"+platform+"/callback" {
			t.Fatalf("%s: the redirect: %s", platform, query.Get("redirect_uri"))
		}
		var id, user, saved string
		var verifier *string
		var lifetime time.Duration
		c.Pool.QueryRow(ctx, `SELECT id, user_id, platform, pkce_verifier_encrypted, expires_at - created_at FROM oauth_states WHERE company_id = $1 AND state_hash = $2 AND used_at IS NULL`,
			company.String(), hashState(state)).Scan(&id, &user, &saved, &verifier, &lifetime)
		check(t, platform+": the attempt", []any{user, saved, lifetime}, []any{owner, platform, 10 * time.Minute})
		if platform == "linkedin" {
			check(t, "LinkedIn has no PKCE", []any{verifier == nil, query.Has("code_challenge")}, []any{true, false})
			continue
		}
		readable, err := c.Box.Decrypt(*verifier, pkceContext(company, id))
		sum := sha256.Sum256([]byte(readable))
		if err != nil || len(readable) != 43 || strings.Contains(*verifier, readable) || query.Get("code_challenge") != base64.RawURLEncoding.EncodeToString(sum[:]) || query.Get("code_challenge_method") != "S256" {
			t.Fatalf("%s: the verifier encrypted, its S256 challenge in the address", platform)
		}
		otherCompany, _ := tenant.FromTrustedSource(database.TestCompany(t, c.Pool))
		if _, err := c.Box.Decrypt(*verifier, pkceContext(otherCompany, id)); err == nil {
			t.Fatal("another company's context reads the verifier")
		}
	}
}

func TestAReturnWorksOnceAndOnlyForWhoStartedItWhereAndWithin10Minutes(t *testing.T) {
	c, company, owner := newConnector(t)
	x := &fakePlatform{}
	withPlatforms(c, x)
	ctx := context.Background()
	address, _, _ := c.Start(ctx, company, owner, "x")
	state := queryOf(t, address).Get("state")
	otherOwner := database.TestOwner(t, c.Pool, company.String())
	strangerCompany, _ := tenant.FromTrustedSource(database.TestCompany(t, c.Pool))
	stranger := database.TestOwner(t, c.Pool, strangerCompany.String())
	back := url.Values{"state": {state}, "code": {"the-code"}}
	for _, who := range []struct {
		company       tenant.CompanyID
		person, where string
	}{{company, otherOwner, "x"}, {strangerCompany, stranger, "x"}, {company, owner, "youtube"}, {company, owner, "myspace"}} {
		if result, _, _ := c.Complete(ctx, who.company, who.person, true, who.where, back); result != "expired_state" {
			t.Fatalf("someone else's state: %s", result)
		}
	}
	check(t, "nobody asked X", x.count(), 0)
	x.answers = connects["x"]
	result, count, err := c.Complete(ctx, company, owner, true, "x", back)
	check(t, "connected", []any{result, count, err}, []any{"connected", 1, nil})
	exchange, _ := url.ParseQuery(strings.SplitN(x.requests[0], " ", 2)[1])
	sum := sha256.Sum256([]byte(exchange.Get("code_verifier")))
	check(t, "X got the verifier whose challenge it was shown", base64.RawURLEncoding.EncodeToString(sum[:]), queryOf(t, address).Get("code_challenge"))
	if again, _, _ := c.Complete(ctx, company, owner, true, "x", back); again != "expired_state" || x.count() != 2 {
		t.Fatalf("a used state never works again: %s", again)
	}
	late, _, _ := c.Start(ctx, company, owner, "linkedin")
	c.Pool.Exec(ctx, `UPDATE oauth_states SET created_at = now() - interval '11 minutes', expires_at = now() - interval '1 minute' WHERE company_id = $1 AND state_hash = $2`,
		company.String(), hashState(queryOf(t, late).Get("state")))
	if result, _, _ := c.Complete(ctx, company, owner, true, "linkedin", url.Values{"state": {queryOf(t, late).Get("state")}, "code": {"c"}}); result != "expired_state" || x.count() != 2 {
		t.Fatalf("past its 10 minutes: %s", result)
	}
}

func TestADenialAnErrorAMissingCodeOrAMemberConnectsNothing(t *testing.T) {
	c, company, owner := newConnector(t)
	x := &fakePlatform{}
	withPlatforms(c, x)
	ctx := context.Background()
	finish := func(isOwner bool, values url.Values) string {
		address, _, _ := c.Start(ctx, company, owner, "x")
		values.Set("state", queryOf(t, address).Get("state"))
		result, _, _ := c.Complete(ctx, company, owner, isOwner, "x", values)
		return result
	}
	check(t, "a no", finish(true, url.Values{"error": {"access_denied"}, "error_description": {"x-access"}}), "denied")
	check(t, "another error", finish(true, url.Values{"error": {"server_error"}}), "provider_error")
	check(t, "no code", finish(true, url.Values{}), "missing_code")
	check(t, "made a member (the session)", finish(false, url.Values{"code": {"c"}}), "not_owner")
	check(t, "nobody asked X", x.count(), 0)
	x.answers = connects["x"]
	address, _, _ := c.Start(ctx, company, owner, "x")
	c.Pool.Exec(ctx, `UPDATE users SET role = 'member' WHERE company_id = $1 AND id = $2`, company.String(), owner)
	result, _, _ := c.Complete(ctx, company, owner, true, "x", url.Values{"state": {queryOf(t, address).Get("state")}, "code": {"c"}})
	check(t, "made a member (the role read again)", result, "not_owner")
	var connections int
	c.Pool.QueryRow(ctx, `SELECT count(*) FROM social_connections WHERE company_id = $1`, company.String()).Scan(&connections)
	check(t, "nothing connected", connections, 0)
}

func TestAccountsAreSavedEncryptedPerConnectionAndReconnectingKeepsTheRow(t *testing.T) {
	c, company, owner := newConnector(t)
	f := &fakePlatform{}
	withPlatforms(c, f)
	ctx := context.Background()
	for _, platform := range []string{"linkedin", "x", "youtube"} {
		check(t, platform, connectFully(t, c, company, owner, platform, f), "connected")
	}
	var id, kind, name string
	var access, refresh *string
	var expires, refreshExpires *time.Time
	c.Pool.QueryRow(ctx, `SELECT id, account_kind, display_name, access_token_encrypted, refresh_token_encrypted, access_expires_at, refresh_expires_at
		FROM social_connections WHERE company_id = $1 AND platform = 'youtube'`, company.String()).Scan(&id, &kind, &name, &access, &refresh, &expires, &refreshExpires)
	readAccess, _ := c.Box.Decrypt(*access, social.TokenContext(company, id, "access"))
	readRefresh, _ := c.Box.Decrypt(*refresh, social.TokenContext(company, id, "refresh"))
	check(t, "the channel", []any{kind, name, readAccess, readRefresh, refreshExpires != nil && refreshExpires.After(*expires)}, []any{"channel", "Ansa Bakery TV", "yt-access", "yt-refresh", true})
	if _, err := c.Box.Decrypt(*refresh, social.TokenContext(company, id, "access")); err == nil {
		t.Fatal("a refresh token reads as an access token")
	}
	var linkedInExpires time.Time
	var linkedInRefresh *string
	c.Pool.QueryRow(ctx, `SELECT access_expires_at, refresh_token_encrypted FROM social_connections WHERE company_id = $1 AND platform = 'linkedin'`, company.String()).Scan(&linkedInExpires, &linkedInRefresh)
	if linkedInRefresh != nil || time.Until(linkedInExpires) < 59*24*time.Hour {
		t.Fatal("a member token: 60 days, no refresh token")
	}
	c.Pool.Exec(ctx, `UPDATE social_connections SET renewal_started_at = now() WHERE company_id = $1 AND id = $2`, company.String(), id)
	outcome, removed, _ := Disconnect(ctx, c.Pool, company, owner, id)
	if outcome != "disconnected" || removed.Platform != "youtube" || removed.ExternalID != "UCabcdefghijklmnopqrstuv" || removed.RefreshEncrypted != *refresh {
		t.Fatalf("disconnected, with what was taken off: %s %+v", outcome, removed)
	}
	check(t, "connected again", connectFully(t, c, company, owner, "youtube", f), "connected")
	var again, status string
	var claimed bool
	c.Pool.QueryRow(ctx, `SELECT id, status, renewal_started_at IS NOT NULL FROM social_connections WHERE company_id = $1 AND platform = 'youtube'`, company.String()).Scan(&again, &status, &claimed)
	check(t, "the same row, connected again, no renewal claim", []any{again, status, claimed}, []any{id, "connected", false})
	var activity int
	c.Pool.QueryRow(ctx, `SELECT count(*) FROM cofounder_activity WHERE company_id = $1 AND action = 'connected' AND actor_user_id = $2`, company.String(), owner).Scan(&activity)
	check(t, "a connected row each time", activity, 4)
}

func TestDisconnectIsForTheCompanysOwnersAndHappensOnce(t *testing.T) {
	c, company, owner := newConnector(t)
	f := &fakePlatform{}
	withPlatforms(c, f)
	ctx := context.Background()
	connectFully(t, c, company, owner, "x", f)
	var id string
	c.Pool.QueryRow(ctx, `SELECT id FROM social_connections WHERE company_id = $1`, company.String()).Scan(&id)
	strangerCompany, _ := tenant.FromTrustedSource(database.TestCompany(t, c.Pool))
	stranger := database.TestOwner(t, c.Pool, strangerCompany.String())
	if outcome, _, _ := Disconnect(ctx, c.Pool, strangerCompany, stranger, id); outcome != "not-found" {
		t.Fatalf("another company's owner: %s", outcome)
	}
	member := database.TestOwner(t, c.Pool, company.String())
	c.Pool.Exec(ctx, `UPDATE users SET role = 'member' WHERE company_id = $1 AND id = $2`, company.String(), member)
	if outcome, _, _ := Disconnect(ctx, c.Pool, company, member, id); outcome != "not-allowed" {
		t.Fatalf("a member: %s", outcome)
	}
	if outcome, removed, _ := Disconnect(ctx, c.Pool, company, owner, id); outcome != "disconnected" || removed == nil {
		t.Fatalf("the owner: %s", outcome)
	}
	if outcome, removed, _ := Disconnect(ctx, c.Pool, company, owner, id); outcome != "already-disconnected" || removed != nil {
		t.Fatalf("once: %s", outcome)
	}
	var status string
	var tokens int
	c.Pool.QueryRow(ctx, `SELECT status, num_nonnulls(access_token_encrypted, refresh_token_encrypted, access_expires_at, refresh_expires_at) FROM social_connections WHERE company_id = $1 AND id = $2`,
		company.String(), id).Scan(&status, &tokens)
	check(t, "the tokens gone, the row kept", []any{status, tokens}, []any{"disconnected", 0})
}

func TestStandInsConnectOnlyInDevelopmentWithoutThePlatformsApp(t *testing.T) {
	c, company, owner := newConnector(t)
	ctx := context.Background()
	c.Development = true
	none := &fakePlatform{}
	withPlatforms(c, none)
	if outcome, _ := c.ConnectStandIn(ctx, company, owner, "youtube"); outcome != "not-set-up" {
		t.Fatal("with ansa's app, no stand-in")
	}
	c.Platforms.Apps = nil
	if _, outcome, _ := c.Start(ctx, company, owner, "youtube"); outcome != "not-set-up" {
		t.Fatal("no app: no consent screen")
	}
	for range 2 {
		if outcome, err := c.ConnectStandIn(ctx, company, owner, "youtube"); err != nil || outcome != "connected" {
			t.Fatalf("stand-in: %s %v", outcome, err)
		}
	}
	var count int
	var name, kind string
	c.Pool.QueryRow(ctx, `SELECT count(*), min(display_name), min(account_kind) FROM social_connections WHERE company_id = $1 AND is_stand_in AND access_expires_at IS NULL`,
		company.String()).Scan(&count, &name, &kind)
	check(t, "one stand-in channel, renewed", []any{count, name, kind, none.count()}, []any{1, "Development stand-in (YouTube)", "channel", 0})
	c.Development = false
	check(t, "production without the app", []string{c.Mode("youtube"), c.Mode("linkedin")}, []string{"not-set-up", "not-set-up"})
	if outcome, _ := c.ConnectStandIn(ctx, company, owner, "linkedin"); outcome != "not-set-up" {
		t.Fatal("production: no stand-in")
	}
}
