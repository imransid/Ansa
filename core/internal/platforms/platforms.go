// Package platforms is how core talks to LinkedIn, X and YouTube (the old
// lib/social-publishing.ts, lib/social-http.ts and adapters/linkedin*.ts,
// x*.ts, youtube*.ts, dev-social.ts): the consent screen's address, a code
// turned into accounts, a token renewed, a post published, its numbers
// read, access given back. One door (Connectors) in front of one file per
// platform and job. No database here: core/internal/social and
// socialconnect save what comes back, and only core/internal/social
// decrypts the tokens these functions are handed. Facebook has its own
// files (socialconnect, publishing, postmetrics). NOT TESTED against the
// real platforms: ansa has no developer app on any of them yet, and the
// tests use fakes only.
package platforms

import (
	"net/http"
	"time"
)

// App is ansa's developer app on one platform: both settings or neither.
type App struct {
	ClientID, ClientSecret string
}

// Connectors reaches LinkedIn, X and YouTube. Make one at start.
type Connectors struct {
	// ansa's app on "linkedin", "x" and "youtube" (LINKEDIN_, X_ and
	// GOOGLE_CLIENT_ID / _SECRET); a platform without one isn't set up.
	Apps map[string]App
	// A development server: a platform without its app offers the stand-in.
	Development bool
	// Where the stand-in writes its posts: <DevFolder>/.dev-social.
	StandInDir string
	// How requests go out: nil = the network. Tests pass a fake.
	Transport http.RoundTripper
	// The clock: nil = time.Now. Tests fix it.
	Now func() time.Time
}

// Mode is "real" (ansa's app is set: owners connect through the
// platform's consent screen), "stand-in" (development without it: a
// stand-in account connects at once) or "not-set-up" (production without
// it: nothing is offered, and the stand-in is never used).
func (c *Connectors) Mode(platform string) string {
	app := c.Apps[platform]
	switch {
	case app.ClientID != "" && app.ClientSecret != "":
		return "real"
	case c.Development:
		return "stand-in"
	}
	return "not-set-up"
}

func (c *Connectors) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

// Account is one account a person allowed ansa to post as, with its tokens.
type Account struct {
	// The platform's id of it (a LinkedIn member's "sub", an X user's id, a
	// YouTube channel's id), its name as one plain line, and what it is
	// ("member", "account", "channel").
	ExternalID, DisplayName, Kind string
	// The permissions granted, as the platform names them.
	Scopes []string
	// RefreshToken "" = none given.
	AccessToken, RefreshToken string
	// nil = the platform gave no expiry.
	AccessExpiresAt, RefreshExpiresAt *time.Time
}

// Media is an image or a video from the media library, as its bytes.
type Media struct {
	// "image" or "video".
	Kind, ContentType string
	Bytes             []byte
	AltText           string
}

// Post is one post as the platform publishes it: the text (the content
// rules' published text), YouTube's title ("" elsewhere), at most one file.
type Post struct {
	Text, Title string
	Media       *Media
}

// Target is who posts: the platform's id of the account and a token that
// works now (core/internal/social renews it first).
type Target struct {
	ExternalID, Token string
}

// PostResult is what a platform said to one post, with the same fields as
// core/internal/publishing's: Kind "published" (PostID, and URL unless the
// stand-in), "not_created" (nothing went out, and trying again can't post
// it twice: Code says why) or "unclear" (it may be up: a person checks;
// never sent again by itself). RetryAfterSeconds: a slow-down's wait, 0 =
// not said.
type PostResult struct {
	Kind, Code, PostID, URL string
	RetryAfterSeconds       int
}

func notCreated(code string, retryAfterSeconds int) PostResult {
	return PostResult{Kind: "not_created", Code: code, RetryAfterSeconds: retryAfterSeconds}
}

func unclear(code string) PostResult {
	return PostResult{Kind: "unclear", Code: code}
}

// Renewal is what asking for new tokens gave. Kind "refreshed" (the new
// tokens; the old refresh token kept when no new one came), "refused" (the
// platform said no: revoked or run out) or "unavailable" (no clear answer:
// the old token may still work; tried again next time).
type Renewal struct {
	Kind                              string
	AccessToken, RefreshToken         string
	AccessExpiresAt, RefreshExpiresAt *time.Time
}

// What ansa asks for on each consent screen, in the platform's own names.
var askedScopes = map[string][]string{
	// openid + profile: who the member is. w_member_social: post as them.
	"linkedin": {"openid", "profile", "w_member_social"},
	// POST /2/tweets needs tweet.read, tweet.write and users.read; images
	// media.write; offline.access brings the refresh token.
	"x": {"tweet.read", "tweet.write", "users.read", "offline.access", "media.write"},
	// youtube.upload: videos.insert. youtube.readonly: which channel was
	// connected (channels.list), and its videos' numbers.
	"youtube": {"https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"},
}

// Scopes are what ansa asks the platform for.
func Scopes(platform string) []string {
	return append([]string{}, askedScopes[platform]...)
}

// UsesPKCE: X and YouTube (Google) document PKCE (S256); LinkedIn and
// Facebook document none.
func UsesPKCE(platform string) bool {
	return platform == "x" || platform == "youtube"
}

// AccountKinds are what a connection posts as on each platform.
var AccountKinds = map[string]string{"linkedin": "member", "facebook": "page", "x": "account", "youtube": "channel"}
