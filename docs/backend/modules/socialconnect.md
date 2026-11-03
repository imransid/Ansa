# socialconnect (core/internal/socialconnect)

**What:** connecting and disconnecting a company's social accounts, and the
Accounts page (the old `services/social-connect.ts`,
`social-oauth-callback.ts`, `social-account-saving.ts`,
`social-disconnect.ts`, `social-accounts.ts`, `db/oauth-states.ts`,
`db/social-connections.ts`, `db/social-connection-disconnects.ts`,
`adapters/facebook.ts`): **Facebook Pages** (one login for posts and
Messenger), **LinkedIn members**, **X accounts** and **YouTube channels**
(their requests are [platforms](platforms.md)'). Owners connect and
disconnect (the role read again FOR SHARE in every write); members read.
No answer, address or log line ever holds a token, the code, the state,
the PKCE verifier or anything a platform wrote.

**Modes (`Connector.Mode(platform)`):** "real" with ansa's app on the
platform (FACEBOOK_APP_ID / _SECRET; LINKEDIN_, X_ and GOOGLE_CLIENT_ID /
_SECRET, each pair both or neither); "stand-in" in development without it
(a stand-in account connects at once: posts go to `.dev-social/`,
Messenger replies to `.dev-messages/`); "not-set-up" in production
without it.

**Connect (`Start`):** an attempt row in `oauth_states` (only the state's
SHA-256; 32 random bytes in the redirect; 10 minutes; the owner's role read
again FOR SHARE); X and YouTube also get a PKCE verifier (32 random bytes),
stored encrypted with `oauth-pkce-verifier:<company>:<attempt>` (a CHECK
allows it exactly there), its S256 challenge in the consent screen's
address. The platform sends the owner back to
`<APP_URL>/api/social/<platform>/callback`, the same address the code
exchange names. Facebook asks for pages_show_list, pages_read_engagement,
pages_manage_posts (posting needs all three), pages_messaging,
pages_manage_metadata (messages) and pages_read_user_content,
pages_manage_engagement (answering comments, [comments](comments.md)): a
person may untick the last four, and posts still work.

**The return (`Complete`), in order:** the state CLAIMED in one UPDATE
(this person, company and platform, unused, unexpired: two returns with one
state connect once); the platform's error ("denied" for a no, else
"provider_error"); the code (1-4,000, no control characters); the person
still an owner; the app set; then the code exchanged (with the attempt's
verifier, decrypted for its company and attempt). Facebook: the code → a
short-lived user token → a long-lived one → `/me/permissions` (all three
posting permissions, else "missing_permission") → `/me/accounts`: one
connection per Page with CREATE_CONTENT, each with its Page token (no
expiry; the user token is never kept; appsecret_proof on every call), none
= "no_pages"; each Page is switched on for ansa's webhook
(`subscribed_apps`, best effort: `webhookFields`) with what the person
allowed: `messages,message_echoes` with the messaging permissions, `feed`
(comments) with both comment ones, nothing without pages_manage_metadata. LinkedIn, X, YouTube: one account
each, with its refresh token and lifetimes when the platform gives them
(see [platforms](platforms.md); "missing_permission", "no_channel").
Result codes: connected, denied, provider_error, expired_state,
missing_code, not_owner, not_set_up, exchange_failed, missing_permission,
no_pages, no_channel, rate_limited.

**Saving (`store.go`):** each token encrypted for its own row
(`social-access-token:<company>:<connection>`, and
`social-refresh-token:...`); a refresh token's end only with the refresh
token; an account connected before keeps its row and id (`ON CONFLICT ...
WHERE id = <the id we encrypted for>`; a row taken under another id at the
same moment = saved again with that id), connected again by this owner, its
problem and any renewal claim cleared; the name one plain line of 1-200;
a "connected" activity row each.

**Disconnect (`Disconnect`):** any platform. ONE transaction removes the
tokens and their lifetimes and keeps the row ("disconnected", a
"disconnected" activity row), and returns what it removed (still
encrypted). After the answer, X and Google are asked to take ansa's access
back ([social](social.md) `RevokeRemoved`: only once no connection of that
account anywhere still holds tokens, a yes-or-no read across companies
listed in CROSS_COMPANY.md); LinkedIn and Facebook offer no revoke with
what ansa keeps (the owner removes ansa on the platform).

**The Accounts page (`AccountsPage`):** per platform (LinkedIn, Facebook,
X, YouTube): label, mode, what a connection posts as, what ansa publishes
there ("Text posts and posts with an image", "Videos only"), its text
limit (from the content rules), the scopes asked, whether a Disconnect
revokes, the missing settings' names (development only), the connections
(connected first, then those needing a reconnect) and the disconnected
ones. Each connection: its status AS OF NOW (past its end with nothing to
renew it = "needs_reauth" token_expired or refresh_expired, before
anything tried to use it), its problem's code and words, its lifetime
("stand-in", "no-end-date", "renews-itself" until the refresh token's own
end, "runs-out" on, "ran-out" on a date that passed, "none"), who
connected it and when. Never a token. The platforms' own facts (media,
scheduling, what ansa still needs) are the screens' text
(`lib/social-platforms.ts`).

**API ([api](api.md)), 30 changes per 10 minutes per person
("social-accounts"), every start and return counted; an unknown platform
is 404:**
- `POST /api/v1/social/{platform}/connect` (owners) → `{"url"}` of the
  consent screen; 409 `{"error"}` when the platform isn't set up ("... isn't
  set up on this development server: connect a stand-in account instead."
  or "... isn't set up by ansa yet.").
- `POST /api/v1/social/{platform}/stand-in` (owners) → `{"outcome":
  "connected"}`; 409 outside development or with the platform's app.
- `GET /api/v1/social/{platform}/callback?state&code|error` → always
  `{"location": "/cofounder/accounts?result=<code>&platform=<platform>[&count=n]"}`
  (the screens forward the browser's return and redirect it there).
- `POST /api/v1/social/connections/{id}/disconnect` (owners) →
  `{"outcome": "disconnected" | "already-disconnected"}`; 404 not the
  company's; the revoke runs after the answer.
- `GET /api/v1/cofounder/accounts` (everyone) → `{"page": {"canManage",
  "showsOperatorNotes", "platforms": [{"platform", "label", "mode",
  "accountKind", "publishes", "textLimit", "scopesAsked",
  "revokesOnRequest", "missingSettings": {"id", "secret"} | null,
  "connections": [...], "disconnected": [...]}]}}`, each connection
  `{"id", "displayName", "accountKind", "status", "problemCode",
  "problem", "scopes", "lifetime": {"kind", "until", "on"}, "isStandIn",
  "connectedAt", "connectedByName", "disconnectedAt"}`.

**Tests (live database; refuse to run with any platform app setting set;
LinkedIn, X and YouTube answer through a fake, Facebook through a local
server):** `connect_test.go` (Facebook: a login connects the one Page they
may post to, its token encrypted for its connection, messages and comments
switched on (`messages,message_echoes,feed`), the fields following what was
allowed,
a made-up or reused state refused, disconnect; an unticked permission, a
denial and a member connect nothing; the stand-in);
`platforms_test.go` (only the state's hash, PKCE where the platform has it,
encrypted for its company and attempt; a return works once, only for who
started it, where, within 10 minutes; a denial, an error, no code or a
member connect nothing; tokens encrypted per connection and kind,
reconnecting keeps the row and ends a renewal claim; disconnect for the
company's owners, once; stand-ins only in development without the app);
`accounts_test.go` (statuses and lifetimes as of now, the words, no token
in the page, missing settings named in development only);
`api/social_test.go` and `api/posts_test.go` (the endpoints, the revoke
after the answer, members refused, nothing secret in the answers or logs).
