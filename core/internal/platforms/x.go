package platforms

import (
	"context"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// X's sign-in (the old adapters/x.ts; docs.x.com's "OAuth 2.0 user access
// token", read 2026-10-28): authorization code with PKCE (S256), ansa's
// app as a confidential client (HTTP Basic with its id and secret), tokens
// of two hours renewed with the refresh token offline.access gives.
// Publishing is in x_posts.go, a post's numbers in x_metrics.go. NOT
// TESTED against X: ansa has no developer app or credits yet. Every post
// and every read is paid.

const (
	xAuthorizeAddress = "https://x.com/i/oauth2/authorize"
	xTokenAddress     = "https://api.x.com/2/oauth2/token"
	xRevokeAddress    = "https://api.x.com/2/oauth2/revoke"
	xMeAddress        = "https://api.x.com/2/users/me"
)

var (
	xNumericID = regexp.MustCompile(`^\d{1,30}$`)
	xUsername  = regexp.MustCompile(`^\w{1,50}$`)
)

func xAuthorizeURL(app App, redirectURI, state, challenge string) string {
	return xAuthorizeAddress + "?" + queryString("response_type", "code", "client_id", app.ClientID, "redirect_uri", redirectURI,
		"scope", strings.Join(askedScopes["x"], " "), "state", state, "code_challenge", challenge, "code_challenge_method", "S256")
}

// xTokenRequest is a form POST to X's token or revoke endpoint as a
// confidential client: HTTP Basic with ansa's id and secret, no client_id
// in the body.
func xTokenRequest(address string, form url.Values, app App) request {
	return formPost(address, form, map[string]string{"Authorization": basicAuthorization(app)})
}

// xAuthorize: the code (with its PKCE verifier) -> tokens -> who the account is.
func (c *Connectors) xAuthorize(ctx context.Context, app App, redirectURI, code, verifier string) ([]Account, string) {
	form := url.Values{"code": {code}, "grant_type": {"authorization_code"}, "redirect_uri": {redirectURI}, "code_verifier": {verifier}}
	tokens, ok := readTokens(c.send(ctx, xTokenRequest(xTokenAddress, form, app)), 2000)
	if !ok {
		return nil, "exchange_failed"
	}
	var me struct {
		Data *struct {
			ID       string  `json:"id"`
			Name     *string `json:"name"`
			Username *string `json:"username"`
		} `json:"data"`
	}
	if !readJSONIfOK(c.send(ctx, bearerGet(xMeAddress, tokens.AccessToken)), &me) || me.Data == nil || !xNumericID.MatchString(me.Data.ID) ||
		(me.Data.Username != nil && !xUsername.MatchString(*me.Data.Username)) {
		return nil, "exchange_failed"
	}
	account := Account{ExternalID: me.Data.ID, DisplayName: accountName(xDisplayName(me.Data.Name, me.Data.Username), "X account"), Kind: "account",
		Scopes: grantedScopes(tokens.Scope, askedScopes["x"]), AccessToken: tokens.AccessToken, RefreshToken: tokens.RefreshToken,
		AccessExpiresAt: expiryFrom(tokens.ExpiresIn, c.now())}
	return []Account{account}, ""
}

// xDisplayName is "Name (@username)", or what X gave of the two.
func xDisplayName(name, username *string) string {
	switch {
	case username != nil && name != nil:
		return *name + " (@" + *username + ")"
	case username != nil:
		return *username + " (@" + *username + ")"
	case name != nil:
		return *name
	}
	return ""
}

func (c *Connectors) xRenew(ctx context.Context, app App, refreshToken string) Renewal {
	form := url.Values{"refresh_token": {refreshToken}, "grant_type": {"refresh_token"}}
	return c.renewalFrom(c.send(ctx, xTokenRequest(xTokenAddress, form, app)), refreshToken, false)
}

// xRevoke takes the refresh token back first (it would mint new access
// tokens), then the access token.
func (c *Connectors) xRevoke(ctx context.Context, app App, accessToken, refreshToken string) string {
	for _, token := range []string{refreshToken, accessToken} {
		if token == "" {
			continue
		}
		answered := c.send(ctx, xTokenRequest(xRevokeAddress, url.Values{"token": {token}}, app))
		if !answered.answered() {
			return answered.noAnswer
		}
		if !answered.ok() {
			return "status_" + strconv.Itoa(answered.status)
		}
	}
	return "revoked"
}
