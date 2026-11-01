package platforms

import (
	"context"
	"encoding/json"
	"net/url"
	"regexp"
)

// LinkedIn's sign-in (the old adapters/linkedin.ts): the 3-legged OAuth
// flow, and "Sign In with LinkedIn using OpenID Connect" for who the member
// is (learn.microsoft.com, read 2026-10-28). No PKCE: the flow documents
// none. A refresh token comes only for LinkedIn's approved partners, so a
// member's token ends after its 60 days (a reconnect). Publishing is in
// linkedin_posts.go. NOT TESTED against LinkedIn.

const (
	linkedInAuthorizeAddress = "https://www.linkedin.com/oauth/v2/authorization"
	linkedInTokenAddress     = "https://www.linkedin.com/oauth/v2/accessToken"
	linkedInUserInfoAddress  = "https://api.linkedin.com/v2/userinfo"
)

var linkedInMemberID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,100}$`)

func linkedInAuthorizeURL(app App, redirectURI, state string) string {
	return linkedInAuthorizeAddress + "?" + queryString("response_type", "code", "client_id", app.ClientID,
		"redirect_uri", redirectURI, "state", state, "scope", "openid profile w_member_social")
}

// linkedInAuthorize: the code -> tokens -> who the member is (/v2/userinfo).
func (c *Connectors) linkedInAuthorize(ctx context.Context, app App, redirectURI, code string) ([]Account, string) {
	form := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "client_id": {app.ClientID}, "client_secret": {app.ClientSecret}, "redirect_uri": {redirectURI}}
	tokens, ok := readTokens(c.send(ctx, formPost(linkedInTokenAddress, form, nil)), 2000)
	if !ok {
		return nil, "exchange_failed"
	}
	var member struct {
		Sub  string `json:"sub"`
		Name string `json:"name"`
	}
	if !readJSONIfOK(c.send(ctx, bearerGet(linkedInUserInfoAddress, tokens.AccessToken)), &member) || !linkedInMemberID.MatchString(member.Sub) {
		return nil, "exchange_failed"
	}
	scopes := grantedScopes(tokens.Scope, askedScopes["linkedin"])
	if !contains(scopes, "w_member_social") {
		return nil, "missing_permission"
	}
	now := c.now()
	account := Account{ExternalID: member.Sub, DisplayName: accountName(member.Name, "LinkedIn member"), Kind: "member", Scopes: scopes,
		AccessToken: tokens.AccessToken, RefreshToken: tokens.RefreshToken, AccessExpiresAt: expiryFrom(tokens.ExpiresIn, now)}
	if tokens.RefreshToken != "" {
		account.RefreshExpiresAt = expiryFrom(tokens.RefreshTokenExpiresIn, now)
	}
	return []Account{account}, ""
}

// linkedInRenew is programmatic refresh, for LinkedIn's partners only.
func (c *Connectors) linkedInRenew(ctx context.Context, app App, refreshToken string) Renewal {
	form := url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refreshToken}, "client_id": {app.ClientID}, "client_secret": {app.ClientSecret}}
	return c.renewalFrom(c.send(ctx, formPost(linkedInTokenAddress, form, nil)), refreshToken, true)
}

// renewalFrom reads a token endpoint's answer to a refresh: no answer, a
// 5xx or a 429 is "unavailable" (ask again later); another refusal
// "refused"; withRefreshExpiry: the platform names the refresh token's end.
func (c *Connectors) renewalFrom(a answer, oldRefreshToken string, withRefreshExpiry bool) Renewal {
	if !a.answered() || a.status >= 500 || a.status == 429 {
		return Renewal{Kind: "unavailable"}
	}
	if !a.ok() {
		return Renewal{Kind: "refused"}
	}
	tokens, ok := readTokens(a, 4000)
	if !ok {
		return Renewal{Kind: "unavailable"}
	}
	now := c.now()
	renewal := Renewal{Kind: "refreshed", AccessToken: tokens.AccessToken, RefreshToken: oldRefreshToken, AccessExpiresAt: expiryFrom(tokens.ExpiresIn, now)}
	// Whether the platform hands out a new refresh token each time is not
	// confirmed (X): the new one is kept when it comes, else the old one.
	if tokens.RefreshToken != "" {
		renewal.RefreshToken = tokens.RefreshToken
	}
	if withRefreshExpiry {
		renewal.RefreshExpiresAt = expiryFrom(tokens.RefreshTokenExpiresIn, now)
	}
	return renewal
}

// tokens is a token endpoint's answer, read strictly.
type tokens struct {
	AccessToken           string `json:"access_token"`
	ExpiresIn             whole  `json:"expires_in"`
	RefreshToken          string `json:"refresh_token"`
	RefreshTokenExpiresIn whole  `json:"refresh_token_expires_in"`
	Scope                 string `json:"scope"`
}

// readTokens reads a 2xx token answer: a token of 1-8,000 characters,
// lifetimes above 0, a refresh token of at most 8,000 and scopes of at most
// scopeMax; anything else is no answer ansa uses.
func readTokens(a answer, scopeMax int) (tokens, bool) {
	var read tokens
	if !a.ok() || a.body == nil || json.Unmarshal(a.body, &read) != nil {
		return tokens{}, false
	}
	switch {
	case read.AccessToken == "" || utf16Length(read.AccessToken) > 8000, utf16Length(read.RefreshToken) > 8000, utf16Length(read.Scope) > scopeMax:
		return tokens{}, false
	case read.ExpiresIn.set && read.ExpiresIn.value <= 0, read.RefreshTokenExpiresIn.set && read.RefreshTokenExpiresIn.value <= 0:
		return tokens{}, false
	}
	return read, true
}
