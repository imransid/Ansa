// Package socialconnect connects and disconnects a company's social
// accounts (the old services/social-connect.ts, social-oauth-callback.ts,
// social-account-saving.ts, social-disconnect.ts, social-accounts.ts,
// db/oauth-states.ts, db/social-connections.ts): Facebook Pages (posts and
// Messenger, one login for both), LinkedIn members, X accounts and YouTube
// channels, and the Accounts page. Owners connect and disconnect; members
// read. No answer, log or address ever holds a token, the code, the state
// or a platform's words.
package socialconnect

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"

	"ansa/core/internal/contentrules"
	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/platforms"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// The development stand-in's account id on every platform.
const standInAccountID = contentrules.StandInAccountID

// Account is one account a platform authorized: a Facebook Page, a
// LinkedIn member, an X account, a YouTube channel.
type Account = platforms.Account

// Connector connects social accounts.
type Connector struct {
	Pool *database.Pool
	Box  *secure.Box
	Log  *logging.Logger
	// ansa's Meta app (both or neither), and the app's own address (the
	// platform sends the owner back to <AppURL>/api/social/<platform>/callback).
	AppID, AppSecret, AppURL string
	Development              bool
	// LinkedIn, X and YouTube (their apps, requests and stand-in); nil: none set up.
	Platforms *platforms.Connectors
}

// IsPlatform says whether ansa connects this platform.
func IsPlatform(platform string) bool {
	return contentrules.Takes(contentrules.Platforms, platform)
}

// Mode is "real" (ansa's app on the platform is set), "stand-in"
// (development without it: a stand-in account connects at once) or
// "not-set-up".
func (c *Connector) Mode(platform string) string {
	switch {
	case platform == "facebook" && c.AppID != "" && c.AppSecret != "":
		return "real"
	case platform != "facebook" && c.Platforms != nil && c.Platforms.Mode(platform) == "real":
		return "real"
	case c.Development:
		return "stand-in"
	}
	return "not-set-up"
}

// redirectURI is where the platform sends the owner back: the consent
// screen and the code exchange must send the very same address, and it is
// registered with the platform's app.
func (c *Connector) redirectURI(platform string) string {
	return c.AppURL + "/api/social/" + platform + "/callback"
}

// Start saves a connection attempt (owners: the role read again; only the
// state's SHA-256 hash is stored, for 10 minutes; X and YouTube's PKCE
// verifier encrypted) and gives the consent screen's address to send the
// owner to. "not-allowed" or "not-set-up" instead of an address.
func (c *Connector) Start(ctx context.Context, company tenant.CompanyID, actorUserID, platform string) (address, outcome string, err error) {
	if !IsPlatform(platform) || c.Mode(platform) != "real" {
		return "", "not-set-up", nil
	}
	state, err := randomText()
	if err != nil {
		return "", "", err
	}
	verifier := ""
	if platforms.UsesPKCE(platform) {
		if verifier, err = randomText(); err != nil {
			return "", "", err
		}
	}
	saved, err := createAttempt(ctx, c.Pool, c.Box, company, actorUserID, platform, hashState(state), verifier)
	if err != nil || !saved {
		return "", "not-allowed", err
	}
	if platform == "facebook" {
		return authorizeURL(c.AppID, c.redirectURI(platform), state), "started", nil
	}
	return c.Platforms.AuthorizeURL(platform, c.redirectURI(platform), state, pkceChallenge(verifier)), "started", nil
}

// ConnectStandIn connects a platform's development stand-in account at
// once (no consent screen): only on a development server without the
// platform's app. Connecting it again renews it. "connected",
// "not-allowed" or "not-set-up".
func (c *Connector) ConnectStandIn(ctx context.Context, company tenant.CompanyID, actorUserID, platform string) (string, error) {
	if !IsPlatform(platform) || c.Mode(platform) != "stand-in" {
		return "not-set-up", nil
	}
	if platform == "facebook" {
		token, err := conversations.NewID()
		if err != nil {
			return "", err
		}
		account := Account{ExternalID: standInAccountID, DisplayName: "Development stand-in (Facebook)", Kind: "page", Scopes: allScopes, AccessToken: "dev-stand-in-" + token}
		return saveAccounts(ctx, c.Pool, c.Box, company, actorUserID, platform, []Account{account})
	}
	account, err := platforms.StandInAccount(platform, contentrules.PlatformLabels[platform], platforms.Scopes(platform))
	if err != nil {
		return "", err
	}
	return saveAccounts(ctx, c.Pool, c.Box, company, actorUserID, platform, []Account{account})
}

// randomText is 32 random bytes, base64url (43 characters): a state (X
// allows up to 500) or a PKCE verifier (43 to 128).
func randomText() (string, error) {
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(random), nil
}

// hashState is what is stored and looked up: the state's SHA-256, hex. No
// secret key: 256 random bits can't be guessed back from their hash.
func hashState(state string) string {
	sum := sha256.Sum256([]byte(state))
	return hex.EncodeToString(sum[:])
}

// pkceChallenge is a verifier's S256 challenge (RFC 7636): base64url of
// its SHA-256; "" without a verifier.
func pkceChallenge(verifier string) string {
	if verifier == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// pkceContext ties an attempt's encrypted verifier to its company and
// attempt (the old oauthPkceVerifierContext).
func pkceContext(company tenant.CompanyID, attemptID string) string {
	return "oauth-pkce-verifier:" + company.String() + ":" + attemptID
}
