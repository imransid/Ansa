// Package socialconnect connects and disconnects a company's social
// accounts (the old services/social-connect.ts, social-oauth-callback.ts,
// social-account-saving.ts, social-disconnect.ts, db/oauth-states.ts):
// today Facebook Pages (posts and Messenger, one login for both). LinkedIn,
// X and YouTube move with the content studio. Owners only. No answer, log
// or address ever holds a token, the code, the state or a platform's words.
package socialconnect

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/url"
	"regexp"

	"ansa/core/internal/conversations"
	"ansa/core/internal/database"
	"ansa/core/internal/logging"
	"ansa/core/internal/secure"
	"ansa/core/internal/tenant"
)

// The development stand-in's account id on every platform.
const standInAccountID = "dev:stand-in"

// Connector connects Facebook Pages.
type Connector struct {
	Pool *database.Pool
	Box  *secure.Box
	Log  *logging.Logger
	// ansa's Meta app (both or neither), and the app's own address (the
	// platform sends the owner back to <AppURL>/api/social/facebook/callback).
	AppID, AppSecret, AppURL string
	Development              bool
}

// Mode is "real" (ansa's Meta app is set), "stand-in" (development
// without it: a stand-in Page connects at once) or "not-set-up".
func (c *Connector) Mode() string {
	switch {
	case c.AppID != "" && c.AppSecret != "":
		return "real"
	case c.Development:
		return "stand-in"
	}
	return "not-set-up"
}

func (c *Connector) redirectURI() string {
	return c.AppURL + "/api/social/facebook/callback"
}

// Start saves a connection attempt (owners: the role read again; only the
// state's SHA-256 hash is stored, for 10 minutes) and gives the consent
// screen's address to send the owner to. "not-allowed" or "not-set-up"
// instead of an address.
func (c *Connector) Start(ctx context.Context, company tenant.CompanyID, actorUserID string) (address, outcome string, err error) {
	if c.Mode() != "real" {
		return "", "not-set-up", nil
	}
	state, err := newState()
	if err != nil {
		return "", "", err
	}
	saved, err := createAttempt(ctx, c.Pool, company, actorUserID, hashState(state))
	if err != nil || !saved {
		return "", "not-allowed", err
	}
	return authorizeURL(c.AppID, c.redirectURI(), state), "started", nil
}

// ConnectStandIn connects the development stand-in Page at once (no
// consent screen): only on a development server without ansa's Meta app.
// Connecting it again renews it. "connected", "not-allowed" or "not-set-up".
func (c *Connector) ConnectStandIn(ctx context.Context, company tenant.CompanyID, actorUserID string) (string, error) {
	if c.Mode() != "stand-in" {
		return "not-set-up", nil
	}
	token, err := conversations.NewID()
	if err != nil {
		return "", err
	}
	account := Account{ExternalID: standInAccountID, DisplayName: "Development stand-in (Facebook)", Kind: "page", Scopes: allScopes, AccessToken: "dev-stand-in-" + token}
	return saveAccounts(ctx, c.Pool, c.Box, company, actorUserID, []Account{account})
}

// The "error" values meaning the person said no: OAuth's own, and
// Facebook's names for it.
var denials = map[string]bool{"access_denied": true, "user_cancelled_login": true, "user_cancelled_authorize": true, "user_denied": true}

var noControlCharacters = regexp.MustCompile(`^[^\x00-\x1f\x7f]+$`)

// Complete answers the owner's return from Facebook's consent screen, in
// this order: the state CLAIMED in one UPDATE (this person, company and
// platform, unused, unexpired: two returns with one state connect once),
// the platform's error, the code, the owner, the app; then the code
// exchanged and the Pages saved, and each Page that allowed messages
// switched on for ansa's webhook. A result code (connected, denied,
// provider_error, expired_state, missing_code, not_owner, not_set_up,
// exchange_failed, missing_permission, no_pages) and how many Pages.
func (c *Connector) Complete(ctx context.Context, company tenant.CompanyID, actorUserID string, isOwner bool, query url.Values) (string, int, error) {
	state := query.Get("state")
	if state == "" || len(state) > 500 || !noControlCharacters.MatchString(state) {
		return "expired_state", 0, nil
	}
	claimed, err := claimAttempt(ctx, c.Pool, company, actorUserID, hashState(state))
	if err != nil || !claimed {
		return "expired_state", 0, err
	}
	if query.Has("error") {
		if denials[query.Get("error")] {
			return "denied", 0, nil
		}
		return "provider_error", 0, nil
	}
	code := query.Get("code")
	switch {
	case code == "" || len(code) > 4000 || !noControlCharacters.MatchString(code):
		return "missing_code", 0, nil
	case !isOwner:
		return "not_owner", 0, nil
	case c.Mode() != "real":
		return "not_set_up", 0, nil
	}
	accounts, failure := facebookPages(ctx, c.AppID, c.AppSecret, c.redirectURI(), code)
	if failure != "" {
		return failure, 0, nil
	}
	outcome, err := saveAccounts(ctx, c.Pool, c.Box, company, actorUserID, accounts)
	if err != nil || outcome != "connected" {
		if outcome == "not-allowed" {
			return "not_owner", 0, err
		}
		return "exchange_failed", 0, err
	}
	c.switchOnMessages(ctx, accounts)
	return "connected", len(accounts), nil
}

// switchOnMessages: best effort; a Page Meta refuses keeps its posts, and
// the log says so (fixed words).
func (c *Connector) switchOnMessages(ctx context.Context, pages []Account) {
	for _, page := range pages {
		if !contains(page.Scopes, "pages_messaging") || !contains(page.Scopes, "pages_manage_metadata") {
			continue
		}
		if !subscribeToMessages(ctx, c.AppSecret, page) {
			c.Log.Warn("socialconnect: messenger messages not switched on for a page", logging.Code("subscribe_refused"))
		}
	}
}

// newState is 32 random bytes, base64url (43 characters).
func newState() (string, error) {
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
