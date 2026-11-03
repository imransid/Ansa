package socialconnect

import (
	"context"
	"net/url"
	"regexp"

	"ansa/core/internal/logging"
	"ansa/core/internal/tenant"
)

// The "error" values meaning the person said no: OAuth's own, and
// LinkedIn's and Facebook's names for it.
var denials = map[string]bool{"access_denied": true, "user_cancelled_login": true, "user_cancelled_authorize": true, "user_denied": true}

var noControlCharacters = regexp.MustCompile(`^[^\x00-\x1f\x7f]+$`)

// Complete answers the owner's return from a platform's consent screen, in
// this order: the state CLAIMED in one UPDATE (this person, company and
// platform, unused, unexpired: two returns with one state connect once),
// the platform's error, the code, the owner, the app; then the code
// exchanged (with the attempt's PKCE verifier) and the accounts saved. A
// result code (connected, denied, provider_error, expired_state,
// missing_code, not_owner, not_set_up, exchange_failed,
// missing_permission, no_pages, no_channel) and how many accounts.
func (c *Connector) Complete(ctx context.Context, company tenant.CompanyID, actorUserID string, isOwner bool, platform string, query url.Values) (string, int, error) {
	state := query.Get("state")
	if !IsPlatform(platform) || state == "" || len(state) > 500 || !noControlCharacters.MatchString(state) {
		return "expired_state", 0, nil
	}
	attempt, err := claimAttempt(ctx, c.Pool, company, actorUserID, platform, hashState(state))
	if err != nil || attempt == nil {
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
	case c.Mode(platform) != "real":
		return "not_set_up", 0, nil
	}
	accounts, failure := c.exchange(ctx, company, platform, code, attempt)
	if failure != "" {
		return failure, 0, nil
	}
	outcome, err := saveAccounts(ctx, c.Pool, c.Box, company, actorUserID, platform, accounts)
	if err != nil || outcome != "connected" {
		if outcome == "not-allowed" {
			return "not_owner", 0, err
		}
		return "exchange_failed", 0, err
	}
	if platform == "facebook" {
		c.switchOnWebhooks(ctx, accounts)
	}
	return "connected", len(accounts), nil
}

// exchange turns the code into the accounts to connect: Facebook's Pages,
// or the one account of LinkedIn, X or YouTube. A failure is a result code.
func (c *Connector) exchange(ctx context.Context, company tenant.CompanyID, platform, code string, attempt *claimedAttempt) ([]Account, string) {
	if platform == "facebook" {
		return facebookPages(ctx, c.AppID, c.AppSecret, c.redirectURI(platform), code)
	}
	verifier := ""
	if attempt.verifierEncrypted != nil {
		readable, err := c.Box.Decrypt(*attempt.verifierEncrypted, pkceContext(company, attempt.id))
		if err != nil || readable == "" {
			return nil, "exchange_failed"
		}
		verifier = readable
	}
	return c.Platforms.Authorize(ctx, platform, c.redirectURI(platform), code, verifier)
}

// switchOnWebhooks switches on each Page's messages and comments for
// ansa's webhook, as far as the person allowed them. Best effort: a Page
// Meta refuses keeps its posts, and the log says so (fixed words).
func (c *Connector) switchOnWebhooks(ctx context.Context, pages []Account) {
	for _, page := range pages {
		fields := webhookFields(page.Scopes)
		if len(fields) == 0 {
			continue
		}
		if !subscribeToPage(ctx, c.AppSecret, page, fields) {
			c.Log.Warn("socialconnect: page webhooks not switched on", logging.Code("subscribe_refused"))
		}
	}
}
