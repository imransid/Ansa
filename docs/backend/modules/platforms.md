# platforms (core/internal/platforms)

**What:** how core talks to LinkedIn, X and YouTube (the old
`lib/social-publishing.ts`, `lib/social-http.ts`, `lib/linkedin-text.ts`,
`lib/metric-definitions.ts`, `adapters/linkedin*.ts`, `x*.ts`, `youtube*.ts`,
`dev-social.ts`): the consent screen's address, a code turned into accounts,
a token renewed, a post published, its numbers read, access given back.
One door, `Connectors`, in front of one file per platform and job. No
database here: [social](social.md) and [socialconnect](socialconnect.md)
save what comes back, and only `core/internal/social` decrypts the tokens
these functions are handed. Facebook has its own files (socialconnect,
publishing, postmetrics). NOT TESTED against the real platforms: ansa has
no developer app on any of them yet.

**Modes (`Connectors.Mode`):** "real" with ansa's app (both settings of the
pair), "stand-in" in development without it, "not-set-up" in production
without it.

**Every request (`http.go`):** its own time limit covering the answer too
(15 s for API calls, 60 s for an image, 180 s for a YouTube video); no
redirect followed (a token must never follow one to another host); at most
1 MB of answer read, only the fields used, strictly (a count that isn't a
whole number, a null where a number belongs, an id of the wrong shape: the
answer is unusable). An error's text is never kept (it can name the
address). A token goes only to the platform's own hosts: an upload or
session address on another host is refused before anything is sent
(`upload_url_refused`, `download.Allowed`).

**Signing in (`linkedin.go`, `x.go`, `youtube.go`):**
- LinkedIn: no PKCE; scopes `openid profile w_member_social`; the code
  exchanged at `/oauth/v2/accessToken`, the member read at `/v2/userinfo`
  (its `sub`); without `w_member_social` granted, "missing_permission". A
  refresh token only for LinkedIn's partners: a member's token ends after
  its 60 days.
- X: PKCE S256; scopes `tweet.read tweet.write users.read offline.access
  media.write`; ansa's app as a confidential client (HTTP Basic, no
  client_id in the body); `/2/users/me`; the name "Name (@username)".
- YouTube: Google's consent screen with `access_type=offline`,
  `prompt=consent`, PKCE S256, both scopes (upload and readonly; either
  unticked = "missing_permission", no channel read); `channels.list`; no
  channel = "no_channel".
- Failures are result codes: exchange_failed, missing_permission,
  no_channel.

**Renewing (`Renew`):** no answer, a 5xx or a 429 = "unavailable" (ask
again later); another refusal = "refused"; a new refresh token kept when
one comes, else the old one. LinkedIn: the same endpoint, partners only (a
429 there is "unavailable" too, where the old code said "refused").

**Revoking (`Revoke`):** X takes the refresh token back first, then the
access token; Google the refresh token (the whole grant). "revoked",
"not_offered" (LinkedIn, Facebook, not set up) or why it failed
(timeout, network_error, status_<n>).

**Publishing (`Publish`):** `PostResult` has publishing's fields (Kind
"published" / "not_created" / "unclear", Code, PostID, URL,
RetryAfterSeconds). LinkedIn: a member post through the Posts API (version
202610, Rest.li 2.0.0), its text in LinkedIn's "little text" format
(`LinkedInLittleText`: reserved characters escaped, valid hashtags as
`{hashtag|\#|tag}`), one image first through the Images API (JPG, PNG,
GIF); 400, 401, 403, 404, 409, 422 (duplicate or unprocessable) and 429
(its Retry-After) created nothing; a 5xx, no answer or a 201 without the
post's id are unclear. X: `POST /2/tweets`, one image first through the v2
media upload (multipart, `tweet_image`; JPG, PNG, GIF, WebP up to 5 MB);
429 waits until `x-rate-limit-reset`; 400, 401, 403, 404 created nothing; a
5xx or a 2xx without `data.id` is unclear. YouTube: videos only, the
resumable `videos.insert` (a POST with the details and `X-Upload-*`
headers, then a PUT of the bytes to the session on `www.googleapis.com`);
a text post or no title asks nothing; a refusal at the start created
nothing (quotaExceeded / uploadLimitExceeded = quota_exceeded); a 5xx or no
answer during the upload is unclear (upload_interrupted), a 404 an expired
session. Videos to LinkedIn and X are refused (video_not_supported).

**Numbers (`ReadNumbers`, `metrics.go`):** one request a
post. X: `GET /2/tweets/<id>` with `public_metrics`, and
`non_public_metrics` (link clicks) while the post is under 29 days old;
reposts + quotes as shares only when X gives both; a 200 holding only X's
resource-not-found problem is not_found. YouTube: `videos.list` with
`part=statistics` (counts as strings of digits). A number left out is nil,
never 0; a count outside 0 to Postgres's integer makes the answer
unreadable; none at all = no_numbers. LinkedIn is never asked
(needs_permission: its member numbers need a Community Management app of
its own); the stand-in never makes numbers up (stand_in); not set up =
not_set_up. What each number means per platform (collected, needs a
permission, not offered) is the Analytics page's one table
([analytics](analytics.md)); `ReadDays` (30 days, X 28) is the one number
both the page and the collector read.

**Stand-in (`standin.go`):** in development a stand-in account's post is a
file, `.dev-social/<platform>/<time>-<id>.json` (the text, the title, the
file's kind, type, size and alt text, never its bytes), refusing what the
real platform would (a YouTube text post, a LinkedIn video); production
refuses it ("stand_in_in_production"). `StandInAccount` makes a platform's
stand-in account (a made-up token that never runs out).

**For the publishing queue and the metrics collector (not wired yet):**
`(*Connectors).Publish(ctx, platform, isStandIn, Target{ExternalID, Token},
Post{Text, Title, Media}) PostResult` and `(*Connectors).ReadNumbers(ctx,
platform, isStandIn, target, postID, publishedAt) (Numbers, code)`, each
after [social](social.md)'s `Renewer.Prepare` got the token;
`LongestPublish` and `LongestNumbersRead` for their time budgets.

**Logging:** none here; callers log codes only.

**Tests:** a fake platform (a recording `http.RoundTripper`); `TestMain`
refuses to run with any platform app setting set, and the network itself
is refused. `linkedin_test.go`, `x_test.go`, `youtube_test.go` (every
request as the platform documents it, every answer's meaning),
`numbers_test.go` (X and YouTube numbers, LinkedIn never asked),
`door_test.go` (the stand-in's file, production refusing it,
time limits, no redirects, the 1 MB cap).
