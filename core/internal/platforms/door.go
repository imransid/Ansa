package platforms

import (
	"context"
	"time"
)

// The one door core uses for LinkedIn, X and YouTube: each call goes to
// the platform's own file, or to the development stand-in for a stand-in
// account. A platform this door doesn't know gets nothing asked.

// LongestPublish is the longest one Publish can take, every request of it
// running out of time: a YouTube video (starting its upload session, then
// sending the bytes). LinkedIn's post with an image is three requests (90
// s), X's two (75 s). The publishing queue starts a post only while this
// still fits in its time.
const LongestPublish = APITimeout + VideoUploadTimeout

// LongestNumbersRead: every platform's numbers are one request.
const LongestNumbersRead = APITimeout

// AuthorizeURL is the platform's consent screen for one connection
// attempt: the state proves the return answers it; challenge is PKCE's
// (X and YouTube), "" elsewhere.
func (c *Connectors) AuthorizeURL(platform, redirectURI, state, challenge string) string {
	app := c.Apps[platform]
	switch platform {
	case "linkedin":
		return linkedInAuthorizeURL(app, redirectURI, state)
	case "x":
		return xAuthorizeURL(app, redirectURI, state, challenge)
	case "youtube":
		return youTubeAuthorizeURL(app, redirectURI, state, challenge)
	}
	return ""
}

// Authorize turns the code the platform sent back (and the attempt's PKCE
// verifier) into the accounts to connect, or a result code:
// exchange_failed, missing_permission or no_channel.
func (c *Connectors) Authorize(ctx context.Context, platform, redirectURI, code, verifier string) ([]Account, string) {
	app := c.Apps[platform]
	switch platform {
	case "linkedin":
		return c.linkedInAuthorize(ctx, app, redirectURI, code)
	case "x":
		return c.xAuthorize(ctx, app, redirectURI, code, verifier)
	case "youtube":
		return c.youTubeAuthorize(ctx, app, redirectURI, code, verifier)
	}
	return nil, "exchange_failed"
}

// Renew asks the platform for new tokens with a refresh token: X (two
// hours) and Google (one hour); LinkedIn only for its approved partners.
// core/internal/social decides when, one run at a time.
func (c *Connectors) Renew(ctx context.Context, platform, refreshToken string) Renewal {
	app := c.Apps[platform]
	switch platform {
	case "linkedin":
		return c.linkedInRenew(ctx, app, refreshToken)
	case "x":
		return c.xRenew(ctx, app, refreshToken)
	case "youtube":
		return c.youTubeRenew(ctx, app, refreshToken)
	}
	return Renewal{Kind: "unavailable"}
}

// Revoke asks X or Google to take ansa's access back: "revoked",
// "not_offered" (LinkedIn and Facebook offer no revoke with what ansa
// keeps, a stand-in or a platform not set up has nothing to ask), or why
// it failed (timeout, network_error, status_<n>). Best effort: the tokens
// are already deleted on ansa's side.
func (c *Connectors) Revoke(ctx context.Context, platform, accessToken, refreshToken string) string {
	if c.Mode(platform) != "real" {
		return "not_offered"
	}
	app := c.Apps[platform]
	switch platform {
	case "x":
		return c.xRevoke(ctx, app, accessToken, refreshToken)
	case "youtube":
		return c.youTubeRevoke(ctx, refreshToken, accessToken)
	}
	return "not_offered"
}

// Publish publishes one post as the account. A stand-in account writes a
// file, and never in production; a real one needs its platform set up on
// this server. The text is the content rules' published text.
func (c *Connectors) Publish(ctx context.Context, platform string, isStandIn bool, target Target, post Post) PostResult {
	if isStandIn {
		if !c.Development {
			return notCreated("stand_in_in_production", 0)
		}
		return c.publishToStandIn(platform, post)
	}
	if c.Mode(platform) != "real" {
		return notCreated("not_set_up", 0)
	}
	switch platform {
	case "linkedin":
		return c.publishLinkedIn(ctx, target, post)
	case "x":
		return c.publishX(ctx, target, post)
	case "youtube":
		return c.publishYouTube(ctx, target, post)
	}
	return notCreated("not_set_up", 0)
}

// ReadNumbers reads one published post's numbers in one request at most:
// the numbers, or why none were read (a code: stand_in, not_set_up and
// needs_permission asked nothing; the others are the platform's answer).
// The stand-in never makes numbers up.
func (c *Connectors) ReadNumbers(ctx context.Context, platform string, isStandIn bool, target Target, postID string, publishedAt time.Time) (Numbers, string) {
	if isStandIn {
		return Numbers{}, "stand_in"
	}
	if c.Mode(platform) != "real" {
		return Numbers{}, "not_set_up"
	}
	switch platform {
	case "x":
		return c.readXNumbers(ctx, target, postID, publishedAt)
	case "youtube":
		return c.readYouTubeNumbers(ctx, target, postID)
	}
	// LinkedIn's member post numbers need r_member_postAnalytics, a
	// permission of the Community Management API on an app of its own:
	// ansa's app can't ask for it, so LinkedIn is never asked.
	return Numbers{}, "needs_permission"
}
