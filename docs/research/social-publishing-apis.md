# Social publishing APIs for a multi-tenant SaaS: LinkedIn, Facebook Pages, YouTube, X (checked 2026-10-26)

**How this was checked.** Every fact comes from the provider's own documentation, fetched today.
- LinkedIn (learn.microsoft.com), Google/YouTube (developers.google.com) and X (docs.x.com, read as raw Markdown) were read in full text.
- Meta's pages (developers.facebook.com) would only load through a summarizing fetch. The Meta quotes below come from that tool, not from raw page text. Recheck them by hand before relying on one word for word.
- "NOT CONFIRMED" means the docs were unclear, contradicted each other, or did not cover the point.

---

## 1. LinkedIn (member posts and organization page posts)

### Endpoint and headers
- **Use the Posts API.** `POST https://api.linkedin.com/rest/posts`. A successful create returns `201`, and the post id is in the `x-restli-id` response header (`urn:li:share:…` or `urn:li:ugcPost:…`). Source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api (updated 2026-05-13)
- **`ugcPosts` is legacy.** Its page is titled "UGC Post API (Legacy)" and says "The Posts API replaces the `ugcPosts` API". https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/ugc-post-api
  - The self-serve "Share on LinkedIn" guide still documents `POST /v2/ugcPosts` and the Assets API. That page is dated 2021. https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
- **Two headers are required on every call:** `Linkedin-Version: YYYYMM` and `X-Restli-Protocol-Version: 2.0.0`. (Posts API page)
- **Versions** (https://learn.microsoft.com/en-us/linkedin/marketing/versioning, updated 2026-10-14):
  - The latest version is `202610`.
  - Versions come out monthly and each is supported for at least one year.
  - A missing or sunset version header returns an error.
  - `202511` is sunset on 2026-11-16.

### Scopes and access
- **Posts API permissions** (Posts API page):
  - `w_member_social`: post as the signed-in member.
  - `w_organization_social`: post as a page. The member must be ADMINISTRATOR, DIRECT_SPONSORED_CONTENT_POSTER or CONTENT_ADMIN on that page.
  - `r_organization_social`: read page posts.
  - `r_member_social`: "restricted… approved users only". The Community Management overview calls it "a **closed** permission. We're not accepting access requests". https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview
- **Self-serve.** Only `w_member_social` (through the "Share on LinkedIn" product), `profile` and `email` are open. https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access
  - That `/rest/posts` works with a token from the Share-on-LinkedIn product alone is **NOT CONFIRMED** in so many words. The Posts API lists `w_member_social`, but the Share-on-LinkedIn guide documents only `ugcPosts`.
- **Community Management API** grants: `w_organization_social`, `r_organization_social`, `rw_organization_admin`, `w_member_social`, `r_member_postAnalytics`, `r_organization_social_feed`, `w_organization_social_feed`, `w_member_social_feed`, `r_organization_followers`, `r_member_profileAnalytics`, `r_basicprofile`, `r_1st_connections_size`. https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access (updated 2026-10-19)
- **Who can get Community Management access** (https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review):
  - Registered legal organizations with commercial use cases only.
  - A verified business email; personal addresses fail.
  - The organization's legal name, address, website and privacy policy.
  - The app must be verified by a super admin of the company's LinkedIn Page.
  - The app name may not contain LinkedIn branding.
- **Development tier** (increasing-access page):
  - 500 calls per app per 24 h and 100 calls per member per 24 h.
  - No BATCH_GET calls.
  - Webhook push notifications are off.
  - The integration must be finished within 12 months.
- **Standard tier:** "No restrictions". It needs a second form, a narrated screencast of each use case (OAuth, posting, how comments and commenter data are shown) and test credentials.
- **Rejection is final for that app.** "You won't be able to re-apply… with your existing app"; you must create a new app. (app review page)
- **Use a new app.** Request Community Management "with new developer applications that don't have access to other API products." (CM overview FAQ #4)

### Images and video
- **Images API** (https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api):
  1. `POST /rest/images?action=initializeUpload` with `{"initializeUploadRequest":{"owner":"urn:li:organization:…|urn:li:person:…"}}`. The response holds `uploadUrl`, `image` (URN) and `uploadUrlExpiresAt`.
  2. Upload the binary to `uploadUrl`.
  3. Put the URN in `content.media.id` of the post.
  - Formats: JPG, GIF and PNG, under 36,152,320 pixels; a GIF may have up to 250 frames.
  - Status values: `WAITING_UPLOAD`, `PROCESSING`, `AVAILABLE`, `PROCESSING_FAILED`.
  - **Gotcha:** "tokens with only `w_member_social` permissions would be unable to perform a GET call for rest/images", so a member-only token cannot poll image status.
- **Videos API** (https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api):
  1. `POST /rest/videos?action=initializeUpload` with `owner`, `fileSizeBytes`, `uploadCaptions` and `uploadThumbnail`.
  2. PUT each 4 MB part to the URLs in `uploadInstructions[]` and save each part's ETag.
  3. `POST /rest/videos?action=finalizeUpload` with `uploadToken` and the ordered `uploadedPartIds`.
  4. Poll until `status` is `AVAILABLE`.
  - Spec: MP4, 3 s to 30 min, 75 KB to 500 MB. The schema separately says "Maximum allowed Videos size is 5GB". The two figures conflict.
  - Upload URLs typically expire 30 days after the upload is initialized.

### Tokens
- **Access tokens:** "Currently, all access tokens are issued with a 60-day lifespan." https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow
  - "If you request a different scope than the previously granted scope, all the previous access tokens are invalidated."
- **Refresh tokens** are programmatic and only for "approved Marketing Developer Platform (MDP) partners" ("a limited set of partners"). They last 365 days from first consent; each refresh mints a new 60-day access token without extending that year. https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens
  - Whether Community Management approval includes refresh tokens is **NOT CONFIRMED**.
  - Without refresh tokens, renewal means re-running OAuth. The consent screen is skipped if the member is still logged in and the token is unexpired.

### Scheduling
- **No native scheduling.** `lifecycleState`: "PUBLISHED is the only accepted field during creation." https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/post-api-schema

### Metrics
- **Member posts:** `GET /rest/memberCreatorPostAnalytics`, scope `r_member_postAnalytics` (Community Management API). https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/post-statistics
  - `q=entity` returns one post; `q=me` returns the member's aggregate.
  - `queryType` values: `IMPRESSION`, `MEMBERS_REACHED`, `RESHARE`, `REACTION`, `COMMENT`. From version 202604 on, also `POST_SAVE`, `POST_SEND`, `LINK_CLICKS`, `PREMIUM_CTA_CLICKS`, `FOLLOWER_GAINED_FROM_CONTENT`, `PROFILE_VIEW_FROM_CONTENT`.
  - `aggregation` is `DAILY` or `TOTAL`. DAILY does not work for MEMBERS_REACHED, LINK_CLICKS, FOLLOWER_GAINED_FROM_CONTENT or PROFILE_VIEW_FROM_CONTENT.
- **Page posts:** `GET /rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=…&shares=List(…)` or `ugcPosts=…`. https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/share-statistics
  - Scope `rw_organization_admin`, and the member must be ADMINISTRATOR. `r_organization_social` is not enough.
  - Fields: `impressionCount`, `uniqueImpressionsCount`, `clickCount`, `likeCount`, `commentCount`, `shareCount`, `engagement`.
  - Organic only, rolling 12 months, no time-bound data for specific posts.
- **Reactions and comment counts:** `GET /rest/socialMetadata/{urn}` returns `reactionSummaries` and `commentSummary.count`. It "replaces… the existing `socialActions` endpoint". Scopes: `r_organization_social_feed`; `r_member_social_feed` is restricted. https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/social-metadata-api

### Rate limits
- Daily per-app and per-member limits that reset at midnight UTC. A breach returns 429. Standard limits "are not published" and are shown per endpoint under your app's Analytics tab in the Developer Portal. https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/rate-limits
- Share on LinkedIn: 150 requests per member per day and 100,000 per app per day. (Share on LinkedIn page)
- Development tier: as listed above.

### Duplicates and retry safety
- **Duplicate guard.** The legacy UGC doc lists `422 "Content is a duplicate of {share or UGC URN}"`: "Wait 10 minutes for the duplicate restriction to expire or modify the content." The same table lists `409` write conflict ("retry the create operation") and `429` "share limit has been reached" (a daily cap per author).
  - Whether `/rest/posts` has the same 10-minute guard is **NOT CONFIRMED**. The Posts API error table lists `422 UNPROCESSABLE_ENTITY` with a generic description.
  - There is no idempotency key.
- **Definitely not created** (Posts API error table): `400` (INVALID_URN_*, MISSING_FIELD, FIELD_LENGTH_TOO_LONG…), `401`, `403 ACCESS_DENIED`, `422`, `429`.
  - `409 CONFLICT` comes with "Retry the request", which implies nothing was written.
- **Unclear outcome:** `500` and `503` (docs say retry), plus timeouts.
  - For a page, read back with `GET /rest/posts?q=author&author={org}&sortBy=CREATED` (needs `r_organization_social`) before posting again.
  - For a member, there is no way to list their posts (`r_member_social` is closed). The only safety net is the duplicate rejection, which returns the original post's URN if it applies.

---

## 2. Facebook Pages (Graph API)

### Version
- The current version is **v26.0**, introduced 2026-07-29, end date TBD. v25.0 runs until 2028-07-29 and v24.0 until 2028-02-18. https://developers.facebook.com/docs/graph-api/changelog

### Getting a page token and scopes
- **Page tokens:** call `GET /{user-id}/accounts` (`/me/accounts` in Graph Explorer). Each Page in the response has its own `access_token`, plus `tasks`. https://developers.facebook.com/docs/pages-api/getting-started
- **Publishing needs:** a Page token from someone with the `CREATE_CONTENT` task, plus `pages_manage_posts`, `pages_read_engagement` and `pages_show_list`. https://developers.facebook.com/docs/graph-api/reference/page/feed/
  - The posts guide also lists `pages_manage_engagement`, `pages_read_user_engagement`, and `publish_video` for video. https://developers.facebook.com/docs/pages-api/posts
- **Insights need:** `read_insights` + `pages_read_engagement`, and the ANALYZE task.
- **App Review:** each of these permissions needs an App Review submission with a use-case description and screencast. https://developers.facebook.com/docs/permissions
  - Standard Access works only for "app users who have a role on the requesting app".
  - Advanced Access (needed for other businesses' Pages) requires Business Verification. https://developers.facebook.com/docs/graph-api/overview/access-levels

### Posting
- **Text or link:** `POST /{page-id}/feed` with `message` and `link`. The response holds `id`. "An app can only update a Page post if that app created it." (posts guide)
- **Photo:** `POST /{page-id}/photos` with `url` or a file upload, plus `caption`. It returns `id` and `post_id`. https://developers.facebook.com/docs/graph-api/reference/page/photos/
  - Formats: jpeg, bmp, png, gif, tiff. Maximum 10 MB.
  - Multi-photo post: upload each photo with `published=false`, then post to `/feed` with `attached_media[n]={"media_fbid":…}`.
  - Unpublished photos are deleted after about 24 h.
- **Video, resumable** (https://developers.facebook.com/docs/video-api/guides/publishing):
  1. `POST /{app-id}/uploads` with file name, length and type. This returns `upload:<id>`.
  2. `POST /upload:<id>` with header `file_offset`. This returns a handle `h`. If interrupted, read the offset back with a GET and continue.
  3. `POST https://graph-video.facebook.com/v26.0/{page-id}/videos` with `fbuploader_video_file_chunk=<h>`, `title` and `description`.
  - The reference also documents `file_url` and `upload_phase` (start, transfer, finish, cancel). https://developers.facebook.com/docs/graph-api/reference/page/videos/
  - Video size and duration limits: **NOT CONFIRMED** (not on the pages read).

### Scheduling (native)
- Send `published=false` + `scheduled_publish_time`.
- **The docs disagree on the window for feed posts.** The posts guide says "between 10 minutes and 30 days"; the `/feed` reference says "between 10 minutes and 75 days". Treat 30 days as the safe maximum.
- Videos: "between 10 mins and 6 months".
- Scheduled multi-photo posts also need `unpublished_content_type=SCHEDULED`. (photos reference)

### Tokens
- Short-lived tokens expire "in hours". A long-lived user token lasts "about 60 days". "Long-lived Page access token do not have an expiration date" when derived from a long-lived user token. https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
- **Data access expires** 90 days after the user was last active. After that the app must re-ask with `auth_type=reauthorize`. https://developers.facebook.com/docs/facebook-login/auth-vs-data/
  - Whether Page tokens stop working when this happens is **NOT CONFIRMED**.

### Metrics
- **Insights edge** (https://developers.facebook.com/docs/graph-api/reference/insights):
  - Views: `post_media_view`, `post_total_media_view_unique`.
  - Reactions: `post_reactions_by_type_total`, `post_reactions_*_total`.
  - Clicks: `post_clicks` and `post_clicks_by_type` (lifetime only).
  - Video: `post_video_views*`, `post_video_avg_time_watched`, and others.
- **Deprecations:**
  - `post_impressions*` (including `_unique`, `_paid`, `_organic`, `_viral`…) is "Deprecated above Graph API v25".
  - "By June 15, 2026, a number of the Page Insights metrics will be deprecated for all API versions." Calls to them return an invalid-metric error.
  - Meta's blog: "Beginning November 15, 2025, we're deprecating the 'impressions' and 'page fans' metrics… replaced by the `views` metric on all API versions." https://developers.facebook.com/blog/post/2025/08/15/page-insights-api-updates/
  - **Build on `post_media_view`, not impressions.**
- **On the post itself:** the `shares` field (`count`), plus `reactions` and `comments` edges and an `insights` edge. https://developers.facebook.com/docs/graph-api/reference/post/

### Rate limits
- **Pages calls with a Page token:** "Calls within 24 hours = 4800 * Number of Engaged Users". https://developers.facebook.com/docs/graph-api/overview/rate-limiting
- **User or app tokens:** "200 * Number of Users" per hour.
- **Headers:** `X-Business-Use-Case-Usage` (includes `estimated_time_to_regain_access`) and `X-App-Usage`.
- **Throttle codes:** 4, 17, 32, 613, 80001.

### Duplicates and retry safety
- **Duplicate guard.** Error `506` "Duplicate Post": "Duplicate posts cannot be published consecutively. Change the content of the post and try again." https://developers.facebook.com/docs/graph-api/guides/error-handling
- There is no idempotency key (none documented).
- **Definitely not created:** 506; throttling (4, 17, 32, 341, 613, 80001; wait, then retry); 190 and session subcodes (get a new token); 10 and 200–299 (permissions); 368 (blocked for policy); 100 (invalid parameter, per the videos reference); 1609005 (link error).
- **Unclear outcome:** codes 1 and 2 ("temporary… wait and retry"), timeouts, and 5xx. Read back with `GET /{page-id}/feed` before re-posting. A scheduled post does not show in `/feed`; look for it with the `is_published` field.

---

## 3. YouTube (Data API v3 and Analytics API)

### Scopes
- `videos.insert` accepts `youtube.upload`, `youtube`, `youtube.force-ssl` or `youtubepartner`. https://developers.google.com/youtube/v3/docs/videos/insert (updated 2026-10-15)
- **Analytics:** `yt-analytics.readonly`. The query page now also says: "API requests to this method now require access to the `https://www.googleapis.com/auth/youtube.readonly` scope." https://developers.google.com/youtube/analytics/reference/reports/query

### Upload
- `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, with headers `X-Upload-Content-Length` and `X-Upload-Content-Type`. The response's `Location` header is the session URL; PUT the bytes there. https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- Maximum file size 256 GB; MIME `video/*`. (insert page)

### Quota (changed in 2025–2026)
- **Separate upload bucket.** Since 2026-06-01, quota is split: `videos.insert` and `search.list` each have their own bucket. https://developers.google.com/youtube/v3/revision_history
- **What one upload costs:** "Quota impact: 100 calls per day. A call to this method has a quota cost of 1 unit in the Video Uploads quota bucket." (insert page)
- **Defaults:** "a default quota allocation of 100 search.list calls, 100 videos.insert calls, and 10,000 units per day combined for all other endpoints". https://developers.google.com/youtube/v3/getting-started
- **Other costs:** `videos.update` 50, `thumbnails.set` 50, `videos.list` 1. https://developers.google.com/youtube/v3/determine_quota_cost
- **History:** on 2025-12-04 the cost of an upload dropped from about 1,600 to about 100 units; the 2026 bucket change replaced that.
- **Quota is per Google Cloud project, shared by all your customers.** More than 100 uploads a day needs an API Compliance Audit via the Audit and Quota Extension Form. https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits

### "Unverified projects are locked to private" (NOT CONFIRMED either way)
- The 2020 revision-history entry is still there: "All videos uploaded via the videos.insert endpoint from unverified API projects created after 28 July 2020 will be restricted to private viewing mode. To lift this restriction, each project must undergo an audit".
- **The current reference pages now say the opposite.** Both the insert page and the videos resource page (updated 2026-10-15) state: "Videos uploaded from unverified API projects are not restricted to private viewing mode." https://developers.google.com/youtube/v3/docs/videos
- No revision-history entry announces the change.
- **Confirm with a test upload from a fresh, un-audited project before relying on public uploads.**

### Scheduling (native)
- `status.publishAt` (ISO 8601) "can be set only if the privacy status of the video is private". It only works on a video that has never been published. A time in the past publishes immediately. When set through `videos.update`, `privacyStatus=private` must be sent again. (videos resource page)

### Text-only community posts
- **Not possible through the API.** Channel bulletins were removed in 2020 ("activities.insert method is no longer supported"), and the Data API has no community-post resource. (revision history; resource list at https://developers.google.com/youtube/v3/getting-started)

### Metrics
- **Analytics API core metrics:** `views`, `engagedViews`, `likes`, `dislikes`, `comments`, `shares`, `estimatedMinutesWatched`, `averageViewDuration`, `subscribersGained`, `subscribersLost`. https://developers.google.com/youtube/analytics/metrics
- **Data is 48–72 hours late.** For live counts, use the Data API's `videos.list` statistics. https://developers.google.com/youtube/analytics/revision_history
- **View counting changed 2026-08-27:** public views now count from the first frame; `engagedViews` is new.

### Google OAuth
- Read token lifetime from `expires_in`; the doc's example shows 3920 s. Ask for `access_type=offline` to get a refresh token. https://developers.google.com/identity/protocols/oauth2/web-server
- **Refresh token gotchas** (https://developers.google.com/identity/protocols/oauth2):
  - A project in "Testing" status gets refresh tokens that expire in 7 days.
  - Tokens die after six months unused.
  - The limit is 100 refresh tokens per Google account per client ID; a new one silently invalidates the oldest.
- **Unverified apps** show a warning screen and are capped at "100 new users in total". https://support.google.com/cloud/answer/7454865
  - Sensitive scopes need verification; Google's own example of a sensitive scope is "deleting a YouTube video". https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
  - That `youtube.upload` itself is classified sensitive is **NOT CONFIRMED** on an official page.

### Rate limits
- `quotaExceeded` (403), `rateLimitExceeded`, and `uploadLimitExceeded` (400, "exceeded the number of videos they may upload"; the number is not published). https://developers.google.com/youtube/v3/docs/errors and the insert page

### Duplicates and retry safety
- No duplicate guard and no idempotency key (none documented).
- **The resumable session is the safety net:**
  - "If the upload has already completed, regardless of whether it succeeded or failed, the API will return the same response that it sent when the upload originally completed."
  - Interrupted uploads return `308 Resume Incomplete` with a `Range` header.
  - After 500, 502, 503 or 504, resume the same session with backoff.
  - `404` means the session expired; start a new one.
  - Other 4xx or 5xx mean the upload "failed permanently".
- **Rule: after any unclear failure, query the session's status. Never start a new `videos.insert`.** A 4xx at session start means nothing was created.

---

## 4. X (API v2)

### OAuth
- **Flow:** authorization code with PKCE (`code_challenge` is required). https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code
  - Authorize at `https://x.com/i/oauth2/authorize`; get tokens at `https://api.x.com/2/oauth2/token`.
  - Confidential clients authenticate with an Authorization header.
- **Lifetime:** the access token "will only stay valid for two hours unless you've used the `offline.access` scope". "If the scope `offline.access` is applied an OAuth 2.0 refresh token will be issued."
  - Whether refresh tokens rotate or are single-use is **NOT CONFIRMED**.
- **Scopes:**
  - `POST /2/tweets` needs `tweet.read`, `users.read` and `tweet.write`. https://docs.x.com/x-api/posts/create-post
  - Media upload needs `media.write`. https://docs.x.com/x-api/media/initialize-media-upload and https://docs.x.com/x-api/media/upload-media
  - Also request `offline.access` to get a refresh token.

### Posting
- `POST /2/tweets` with `text` (required unless media is attached), `media.media_ids`, `reply`, `quote_tweet_id`, `poll`, `reply_settings`, `made_with_ai`, `paid_partnership`, `community_id`, `edit_options`. Success is `201`. (create-post page)

### Media (v2 upload is current)
- The simple `POST /2/media/upload` is for images and small files.
- **Chunked upload** for all video and GIF: https://docs.x.com/x-api/media/quickstart/media-upload-chunked
  1. `POST /2/media/upload/initialize` (JSON body). The `media_id` expires after 86,400 s.
  2. `POST /2/media/upload/{id}/append` in segments of at most 5 MB (server maximum 8 MB).
  3. `POST /2/media/upload/{id}/finalize`.
  4. Poll `GET /2/media/upload?command=STATUS` until `processing_info.state` is `succeeded`.
  - The old `command=INIT/APPEND/FINALIZE` style on `/2/media/upload` must not be used.
- **Limits** (https://docs.x.com/x-api/media/introduction):
  - Image: 5 MB (JPG, PNG, GIF, WEBP). Animated GIF: 15 MB.
  - Video: 0.5 s to 20 min and 8 GB; 125 min and 16 GB for an X Premium or verified posting user.
  - A post holds up to 4 photos, or 1 GIF, or 1 video.
- **Gotcha:** limits are checked again when the post is created. Media that uploaded fine can still be refused with `403 "This user is not allowed to post a video longer than N minutes."`

### Access and pricing (2026)
- **Pay per use only:** "The X API uses pay-per-usage pricing with no subscriptions". You buy credits in console.x.com. https://docs.x.com/x-api/getting-started/pricing
- **Write prices:** Post create $0.015; **Post create (with URL) $0.200**; summoned $0.010.
- **Read prices:** $0.005 per post read.
  - The cheaper "Owned Reads" rate ($0.001) applies only when the signed-in user owns the developer app. That rules it out for your customers' accounts.
- **Caps:** 3 million post reads per billing cycle, then Enterprise. Spending limits and auto-recharge are available.
- The pricing page gives no effective date. Whether old Free/Basic/Pro plans still exist is **NOT CONFIRMED**: the current docs do not mention them.

### Rate limits
- `POST /2/tweets`: 100 per 15 min per user and 10,000 per 24 h per app. `DELETE` is 50 per 15 min per user. https://docs.x.com/x-api/fundamentals/rate-limits
- `POST /2/media/upload`: 500 per 15 min per user, 50,000 per 24 h per app. Initialize, append and finalize: 1,875 per 15 min per user.
- Headers: `x-rate-limit-limit`, `x-rate-limit-remaining`, `x-rate-limit-reset`.

### Scheduling
- **None for normal posts.** `POST /2/tweets` has no schedule field (create-post schema).
- Scheduled Tweets exist only in the Ads API (`POST accounts/:account_id/scheduled_tweets`), which needs an ads account. https://docs.x.com/x-ads-api/creatives

### Metrics
- **Public:** `public_metrics.retweet_count`, `reply_count`, `like_count`, `quote_count`, `bookmark_count`, `impression_count`. https://docs.x.com/x-api/fundamentals/metrics
- **Own posts, user context:** `non_public_metrics.url_link_clicks`, `user_profile_clicks`, `engagements`, plus `organic_metrics` and `promoted_metrics`. These are available only for posts created in the last 30 days.
- **Video:** `public_metrics.view_count` and `non_public_metrics.playback_{0,25,50,75,100}_count`.

### Duplicates and retry safety
- No duplicate-content error and no idempotency key are documented in the v2 docs (**NOT CONFIRMED**). The "deduplication" on the pricing page is billing only.
- **Definitely not created:** 400, 401, 403 (including the video-length 403), 404, and 429 (`rate-limit-exceeded` or `usage-capped`). https://docs.x.com/x-api/fundamentals/response-codes-and-errors
- **Unclear outcome:** 500, 502, 503, 504 ("wait and retry") and timeouts. Before retrying, read back with `GET /2/users/:id/tweets`; this read is billed.
- A `200` with an `errors` array is a partial success.

---

## Summary

| Platform | Text | Image | Video | Native scheduling | Metrics | Access blocker |
|---|---|---|---|---|---|---|
| LinkedIn member | Yes, `/rest/posts` with `w_member_social` (self-serve Share on LinkedIn; using it with `/rest/posts` NOT CONFIRMED) | Yes, Images API | Yes, Videos API (MP4, 3 s–30 min) | No (only PUBLISHED on create) | `memberCreatorPostAnalytics` (needs Community Management `r_member_postAnalytics`) | Analytics need Community Management (legal entity, Page-verified app, screencast for Standard tier); `r_member_social` closed; refresh tokens only for MDP partners |
| LinkedIn organization | Yes, `w_organization_social` + page role | Yes | Yes | No | `organizationalEntityShareStatistics` (`rw_organization_admin`, ADMINISTRATOR, 12 months), `socialMetadata` | Community Management API vetting; Development tier is 500 calls/app/day and 100/member/day, no BATCH_GET |
| Facebook Page | Yes, `/{page-id}/feed` | Yes, `/photos` (10 MB) | Yes, resumable upload, then `/videos` | Yes (feed: 10 min to 30 or 75 days, docs disagree; video: up to 6 months) | Insights `post_media_view` etc.; impressions deprecated (v25+, all versions by 2026-06-15) | App Review (screencast) for each permission, Advanced Access needs Business Verification; 90-day data-access re-auth |
| YouTube | No (no community posts via API) | No (thumbnail only) | Yes, resumable `videos.insert` | Yes, `publishAt` while `private` | Analytics API (48–72 h delay) + `videos.list` stats | 100 uploads/day per project by default (audit to raise); OAuth verification + 100-user cap, 7-day refresh tokens in Testing; "private until audit" rule now contradicted by the docs (NOT CONFIRMED) |
| X | Yes, `POST /2/tweets` | Yes, v2 media upload (up to 4 images) | Yes, chunked v2 upload | No (Ads API scheduled tweets only) | `public_metrics`; `non_public_metrics` and `organic_metrics` (last 30 days) | Paid per use: $0.015 per post, $0.20 per post with a URL; 100 posts/15 min per user, 10,000/day per app |
---

## 5. Post numbers for step 42 (checked 2026-10-28)

Read again for the analytics step, each from the platform's own reference
(Meta's and Google's pages through the same summarizing fetch as above, so
recheck their wording by hand). For each platform: what ansa can read with
the permissions it already asks for (step 40), and what needs more.

**X** (https://docs.x.com/x-api/fundamentals/metrics)
- Request: `GET https://api.x.com/2/tweets/{id}?tweet.fields=public_metrics` (the page's example), plus `non_public_metrics` in `tweet.fields` for the private ones.
- Both objects sit under `data`, next to `id` and `text`.
- `public_metrics`: `retweet_count`, `reply_count`, `like_count`, `quote_count`, `bookmark_count`, `impression_count`.
- `non_public_metrics`: `impression_count`, `url_link_clicks`, `user_profile_clicks`, `engagements`; "User context (owned posts only)", "only available for posts created within the last 30 days". ansa's OAuth 2.0 user token with `tweet.read` and `users.read` is user context.
- Video views are the media's `public_metrics.view_count` (`expansions=attachments.media_keys&media.fields=public_metrics`): ansa sends no videos to X yet.
- What X answers for a post older than 30 days when `non_public_metrics` is asked for is not documented (an error or the field left out): ansa never asks for it then.
- A post X can't find: "Deleted posts return 404" (https://docs.x.com/x-api/fundamentals/response-codes-and-errors, read 2026-10-28). The same page shows a `200` holding `errors` with `"type": "https://api.x.com/2/problems/resource-not-found"` and `"title": "Not Found Error"`, the partial-error form, for requests of several posts. Which of the two a single post's read gets today is NOT CONFIRMED (older v2 answers used the `200` form, with api.twitter.com in the type): ansa reads both as not found.
- Every read is billed ($0.005 per post read, section 4).

**Facebook Pages** (https://developers.facebook.com/docs/graph-api/reference/insights, /post/, /object/reactions/, /object/comments/)
- Insights (`post_media_view` "the number of times your content was played or displayed", `post_total_media_view_unique` "the number of total unique media viewers", `post_reactions_by_type_total`, `post_clicks`, `post_video_views` "played for at least 3 seconds", all lifetime) need "A Page access token requested by a person who can perform the ANALYZE task on the Page" with `read_insights` and `pages_read_engagement`. ansa doesn't ask for `read_insights`.
- On the post itself: "A page access token can read all posts posted to or posted by that Page." `shares` is a struct with `count`: "Number of times the post has been shared". Whether the field is left out of an unshared post is NOT CONFIRMED.
- Reactions: "Specify the fields to fetch in the summary param (like `summary=total_count`)", example `?fields=reactions.summary(total_count)`, answering `"summary": { "total_count": 28 }` beside `data` (the people who reacted). Page Management apps need `pages_show_list`.
- Comments: `summary` is a boolean ("summary=1"), adding `total_count` ("The count of comments on this node") and `order`; "The same permissions required to view the parent object are required to view comments on that object", and comment ids of a Page post need the MODERATE task.
- `.limit(n)` works on any expanded field or edge (the field-expansion guide); that `.limit(0)`, which ansa sends so that no person who reacted or commented is read, is accepted is NOT CONFIRMED (the guide shows positive limits only).

**YouTube** (https://developers.google.com/youtube/v3/docs/videos and /videos/list)
- `GET https://www.googleapis.com/youtube/v3/videos` with `part=statistics` and `id`: 1 quota unit. The answer's `items[].statistics` holds `viewCount` ("The number of times the video has been viewed"; since 2026-08-24 counted "the moment a video begins to play"), `likeCount`, `commentCount` (each an unsigned long written as a string), `dislikeCount` (private since 2021-12-13) and `favoriteCount` (deprecated, always 0). An unknown id is a 404 `videoNotFound`.
- These are live counts, read with the `youtube.readonly` scope ansa already asks for. The Analytics API (`views`, `shares`, `estimatedMinutesWatched`..., 48-72 hours late, section 3) needs `yt-analytics.readonly`, which ansa doesn't ask for.

**LinkedIn member posts** (https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/post-statistics, updated 2026-05-15)
- `GET https://api.linkedin.com/rest/memberCreatorPostAnalytics?q=entity&entity=(share:urn%3Ali%3Ashare%3A...)&queryType=...` (one `queryType` per request: `IMPRESSION`, `MEMBERS_REACHED`, `RESHARE`, `REACTION`, `COMMENT`, and from 202604 `LINK_CLICKS` and others), `aggregation` `TOTAL` by default; the answer is `elements[].count` with `metricType` (a plain string from version 202605).
- Permission `r_member_postAnalytics`, a Community Management API permission: an app of its own (section 1). ansa's self-serve app can't ask for it, so no LinkedIn post number is read.
