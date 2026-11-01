package platforms

import (
	"context"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// Google's sign-in for YouTube (the old adapters/youtube.ts;
// developers.google.com's "Using OAuth 2.0 for Web Server Applications"
// and channels.list, read 2026-10-28): access_type=offline for a refresh
// token (prompt=consent, so a reconnect gets a new one too: Google gives
// one on the first consent only), PKCE (S256), tokens of about an hour.
// Videos only: the API has no text posts. Uploading is in
// youtube_videos.go, a video's numbers in youtube_metrics.go. NOT TESTED
// against Google: ansa has no verified Google Cloud project yet.

const (
	youTubeAuthorizeAddress = "https://accounts.google.com/o/oauth2/v2/auth"
	youTubeTokenAddress     = "https://oauth2.googleapis.com/token"
	youTubeRevokeAddress    = "https://oauth2.googleapis.com/revoke"
	youTubeChannelsAddress  = "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true"
)

var youTubeChannelID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,100}$`)

func youTubeAuthorizeURL(app App, redirectURI, state, challenge string) string {
	return youTubeAuthorizeAddress + "?" + queryString("client_id", app.ClientID, "redirect_uri", redirectURI, "response_type", "code",
		"scope", strings.Join(askedScopes["youtube"], " "), "access_type", "offline", "prompt", "consent", "state", state,
		"code_challenge", challenge, "code_challenge_method", "S256")
}

// youTubeAuthorize: the code (with its PKCE verifier) -> tokens -> both
// permissions granted -> the account's channel.
func (c *Connectors) youTubeAuthorize(ctx context.Context, app App, redirectURI, code, verifier string) ([]Account, string) {
	form := url.Values{"code": {code}, "client_id": {app.ClientID}, "client_secret": {app.ClientSecret}, "redirect_uri": {redirectURI},
		"grant_type": {"authorization_code"}, "code_verifier": {verifier}}
	tokens, ok := readTokens(c.send(ctx, formPost(youTubeTokenAddress, form, nil)), 4000)
	if !ok {
		return nil, "exchange_failed"
	}
	// Google's consent screen can let the person untick a permission.
	scopes := grantedScopes(tokens.Scope, askedScopes["youtube"])
	for _, needed := range askedScopes["youtube"] {
		if !contains(scopes, needed) {
			return nil, "missing_permission"
		}
	}
	var channels struct {
		Items []struct {
			ID      string `json:"id"`
			Snippet struct {
				Title string `json:"title"`
			} `json:"snippet"`
		} `json:"items"`
	}
	if !readJSONIfOK(c.send(ctx, bearerGet(youTubeChannelsAddress, tokens.AccessToken)), &channels) {
		return nil, "exchange_failed"
	}
	for _, channel := range channels.Items {
		if !youTubeChannelID.MatchString(channel.ID) {
			return nil, "exchange_failed"
		}
	}
	if len(channels.Items) == 0 {
		return nil, "no_channel"
	}
	channel := channels.Items[0]
	now := c.now()
	account := Account{ExternalID: channel.ID, DisplayName: accountName(channel.Snippet.Title, "YouTube channel"), Kind: "channel", Scopes: scopes,
		AccessToken: tokens.AccessToken, RefreshToken: tokens.RefreshToken, AccessExpiresAt: expiryFrom(tokens.ExpiresIn, now)}
	if tokens.RefreshToken != "" {
		account.RefreshExpiresAt = expiryFrom(tokens.RefreshTokenExpiresIn, now)
	}
	return []Account{account}, ""
}

// youTubeRenew: invalid_grant (revoked, unused for six months, or a
// Testing app's 7 days) is refused.
func (c *Connectors) youTubeRenew(ctx context.Context, app App, refreshToken string) Renewal {
	form := url.Values{"client_id": {app.ClientID}, "client_secret": {app.ClientSecret}, "refresh_token": {refreshToken}, "grant_type": {"refresh_token"}}
	return c.renewalFrom(c.send(ctx, formPost(youTubeTokenAddress, form, nil)), refreshToken, false)
}

// youTubeRevoke: revoking the refresh token ends the whole grant, its
// access tokens too.
func (c *Connectors) youTubeRevoke(ctx context.Context, refreshToken, accessToken string) string {
	token := refreshToken
	if token == "" {
		token = accessToken
	}
	if token == "" {
		return "not_offered"
	}
	answered := c.send(ctx, formPost(youTubeRevokeAddress, url.Values{"token": {token}}, nil))
	switch {
	case !answered.answered():
		return answered.noAnswer
	case !answered.ok():
		return "status_" + strconv.Itoa(answered.status)
	}
	return "revoked"
}
