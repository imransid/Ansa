# socialconnect (core/internal/socialconnect)

**What:** connecting and disconnecting a company's social accounts (the old
`services/social-connect.ts`, `social-oauth-callback.ts`,
`social-account-saving.ts`, `social-disconnect.ts`, `db/oauth-states.ts`,
`adapters/facebook.ts`). Today **Facebook Pages**: one login for posts
("Post for me", the publishing queue) and Messenger. LinkedIn, X and
YouTube move with the content studio; until then the old backend connects
and disconnects them (X and Google revoke on request). Owners only (the
role read again in every write). No answer, address or log line ever holds
a token, the code, the state or anything Facebook wrote.

**Modes (`Connector.Mode`):** "real" with ansa's Meta app
(FACEBOOK_APP_ID and FACEBOOK_APP_SECRET, both or neither); "stand-in" in
development without it (a stand-in Page connects at once, posts go to
`.dev-social/`, Messenger replies to `.dev-messages/`); "not-set-up" in
production without it.

**Connect (`Start`):** an attempt row in `oauth_states` (only the state's
SHA-256; 32 random bytes in the redirect; 10 minutes), then Facebook's
consent screen asking for pages_show_list, pages_read_engagement,
pages_manage_posts (posting needs all three) and pages_messaging,
pages_manage_metadata (a person may untick these: posts still work). The
platform sends the owner back to `<APP_URL>/api/social/facebook/callback`.

**The return (`Complete`), in order:** the state CLAIMED in one UPDATE
(this person, company and platform, unused, unexpired: two returns with one
state connect once); Facebook's error ("denied" for a no, else
"provider_error"); the code (1-4,000, no control characters); the person
still an owner; the app set; then the code → a short-lived user token → a
long-lived one → `/me/permissions` (all three posting permissions, else
"missing_permission") → `/me/accounts`: one connection per Page with
CREATE_CONTENT, each with its Page token (no expiry; the user token is
never kept); every Graph call with a token carries appsecret_proof. None =
"no_pages". Each Page that allowed messages is then switched on for ansa's
webhook (`subscribed_apps`: messages, message_echoes; best effort, a fixed
log line when Meta refuses).

**Saving (`store.go`):** each Page's token encrypted for its own row
(`social-access-token:<company>:<connection>`); a Page connected before keeps
its row and id (`ON CONFLICT ... WHERE id = <the id we encrypted for>`; a
row taken under another id at the same moment = saved again with that id);
the name one plain line of 1-200 ("Facebook Page" otherwise); a
"connected" activity row each.

**Disconnect:** ONE transaction removes the token and keeps the row
("disconnected", a "disconnected" activity row). Facebook offers no revoke
with what ansa keeps: the owner removes ansa under Facebook's Business
Integrations.

**API ([api](api.md)), 30 changes per 10 minutes per person, every start
and return counted:** `POST /api/v1/social/facebook/connect` → `{"url"}`;
`POST /api/v1/social/facebook/stand-in`; `GET
/api/v1/social/facebook/callback?state&code|error` → `{"location":
"/cofounder/accounts?result=<code>&platform=facebook[&count=n]"}` (the
screens forward the browser's return and redirect it there);
`POST /api/v1/social/connections/{id}/disconnect`.

**Tests:** `connect_test.go` (live database, a fake Graph API: an owner's
login connects the one Page they may post to, its name one line and its
token encrypted and readable for its connection, messages switched on, a
made-up or reused state refused, disconnect removes the token; an unticked
posting permission, a denial and an owner made a member connect nothing;
the stand-in only in development without the app, connecting it again
renews it); `api/posts_test.go` (the endpoints, members refused).
