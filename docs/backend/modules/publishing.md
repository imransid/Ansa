# publishing (core/internal/publishing, core/internal/drafts)

**What:** the publishing queue (the old `services/publish-*.ts`,
`services/publishing-pages.ts`, `services/draft-publishing.ts`,
`services/autopublish-rules.ts`, `db/publish-*.ts`, `db/autopublish-rules.ts`,
`lib/publishing/`, `adapters/facebook-posts.ts`): one post of one draft to
one account is a `publish_jobs` row. The checks cover **every platform and
format** ansa publishes (`contentrules.PublishedFormats`: text and image
posts to LinkedIn, Facebook and X, videos to YouTube). Core **sends**
Facebook text and image posts today; LinkedIn, X and YouTube plug in at
one place (`senderFor`, below). Until then the old backend's runner sends
those (both runners claim jobs the same way, so a post is never sent twice).
The calendar page is not here (it moves with the calendar).

**Drafts (`core/internal/drafts`):** `Create` saves a new draft (version 1,
every column named; an "idea" when nothing is written; `Generated` = the
AI's text, `generated_version` 1), the person read again FOR SHARE.
`LockWithin` reads a draft with its row locked. `ClaimsChecked` is the old
`reviewDraft`'s "no owner needs to check the claims". A "Post for me" draft
lists none (ansa's own checks of its text replace them).

**The checks (`check.go`, `content.go`, pure but for the reads):** a draft
is blocked by any blocking issue of `contentrules.CheckDraft` (its format,
its image or video, a YouTube title, its text's length as its platform
counts it, its hashtags, and the confirmed "Words to avoid" in its texts
and its media's alt text), read with the draft's title, video script and
attached media (`media_assets` by `content_drafts.media_asset_id`, read in
the same transaction or snapshot). `DecideSchedule` (when a post may be
scheduled: the version the page showed; a format ansa publishes; an
approval of this version by an active owner, or the owner's tick "without
an approval" AND an enabled rule covering the platform and pillar whose
maker and switcher are active owners; the accounts the company's,
connected, of the draft's platform; no live post there already; no
blocking issue; for a rule, no claim needing an owner). `ReasonNotToPublish`
decides it all AGAIN right before sending, on one snapshot.

**Scheduling (`schedule.go`):** `Schedule` (owners only), ONE transaction:
the person FOR SHARE, the draft's row locked, the approver, the rule, the
accounts and the people behind them FOR SHARE, the confirmed facts now.
One job per account, the draft "scheduled", a "scheduled" activity row each
("auto_rule" for a rule's). A live job saved at the same moment = the
partial unique index = "already-scheduled". `CheckScheduleTime`: a time at
most a minute ago and at most a year ahead.

**Running (`runner.go`, `attempt.go`, `claims.go`, `handover.go`,
`snapshot.go`, `media.go`, `outcomes.go`):** the scheduler runs `RunDue`
every 15 seconds ([schedule](schedule.md)); `RunNow` (through `SendSoon`,
after the answer, 10 minutes at most) sends the posts an answer made due
(scheduled for now, "Publish now", a Retry), each claimed by id first. A
post is started only while its slowest run still fits before the run's
end. First, posts cut off while sending (still "publishing" 10+ minutes
after their claim) go to a person: "needs_attention", "interrupted", NEVER
sent again by themselves. Then due posts are CLAIMED one at a time in ONE
UPDATE (a scalar `SKIP LOCKED` subquery, a new `claim_id`, attempts + 1;
listed in CROSS_COMPANY.md), only the "platform:format" pairs core sends,
the companies taking turns, at most 50 a round. Each run, in the old
order: the snapshot (repeatable read, read only) and the check; the
company's daily limit (`publish-attempts`, 30 a day, counted before the
account is read: a held-back post waits an hour, its try given back); the
account (`Sender.Ready`: only [social](social.md) decrypts tokens); the
image or video read from [files](files.md) (30 s; not there = failed
"media_missing", storage failing = tried again later "media_unavailable");
the claim checked once more (still held, and under 7 minutes old, so even
the slowest answer comes before it counts as cut off); then the platform.
Every outcome is ONE transaction: the draft's row locked first, the job
written only while "publishing" under this run's claim id, the draft's
status following its jobs (`DraftStatusFromJobs`), the app's activity row.

**What a platform's answer does:** published → the post's id and address;
unclear (no answer: "timeout" or "network_error"; a 5xx; no id) →
needs_attention, never sent again by itself; rate_limited (and a storage
or renewal that didn't answer) with attempts < 5 → queued again after what
the platform asked (30 s to a day) or 1, 2, 4, 8 minutes; token_rejected →
failed and the account marked "needs_reauth" while it still holds that
token, with a "reconnect_needed" row; any other refusal → failed with its code.

**Where a platform plugs in (`sender.go`):** `senderFor(platform)` is THE
place: a `Sender` is `Ready` (the account for one post: `social.ErrNeedsReconnect`,
`ErrNotConnected`, `ErrNotUsable`, or `ErrRenewalUnavailable` when the
platform didn't answer a renewal), `Publish` (the post: its text, a
video's title, its image or video's bytes, type and alt text) and `SetUp`
(ansa's app is set). Facebook is built in; LinkedIn, X and YouTube go in
`Runner.OtherSenders` (main.go), and the claim (`claimable`) then takes
their posts too. The development stand-in account is handled here for every
platform (a file, below).

**Facebook (`facebook.go`, `facebook_photo.go`):** `PublishToFacebook`: the
text alone to the Page's `/feed` (15 s), or a photo to `/photos` (60 s,
multipart: `source` named "image" with its own type, `caption`,
`published`, `alt_text_custom` when there is one, `access_token`,
`appsecret_proof`); JPEG, PNG or GIF only (else "media_type_not_accepted",
before asking), 10 MB at most ("media_too_large"); a video is
"video_not_supported". No redirects, at most 1 MB read, only the id
(`post_id` for a photo) and the error code are read (Meta's words never).
Codes: Meta's error-handling guide (506 duplicate, 190 token_rejected, 10 /
200-299 permission_denied, 368 blocked_by_policy, 100 invalid_request,
1609005 link_error; throttling 4, 17, 32, 341, 613, 80001 with the
`X-Business-Use-Case-Usage` wait). NOT TESTED against Facebook: ansa's Meta
app needs App Review for pages_manage_posts first.

**Stand-in (`standin.go`):** in development the stand-in account's posts
are files in `.dev-social/<platform>/<time>-<job>.json` ("NOT published
anywhere"; an image or video by its kind, type, size and alt text only);
production fails them "platform_not_set_up".

**An owner's actions (`actions.go`, `retry.go`):** Cancel (queued only),
Publish now (queued: its time becomes now), Mark as published (needs
attention: the post's address kept only as https on the platform's own
hosts, `ReadPostURL`), Mark as not published (needs attention → failed),
each in ONE transaction: the role FOR SHARE, the draft's row, the job's
row (one cut off while sending handed to a person first, in that
transaction), the draft's status, the activity row. Outcomes "changed",
"not-found", "not-allowed", "wrong-status". `RetryJob` (failed, or needs
attention) is checked like a new schedule (its own job not counted as
live), publishes the draft's CURRENT approved version, its tries from 0
again: "retried" or a refusal ("not-retryable", "already-scheduled" when
the account has the draft again since).

**Auto-publish rules (`owner_rules.go`, `rules.go`):** `CreateRule` makes a
rule switched OFF (one per platform and pillar, any case: "exists");
`SetRuleEnabled` switches one on (naming who and when) or off, owners
only; `switchRuleWithin` is the ONE write of `enabled` in core (a test
reads every statement). Both the maker and the switcher must stay active
owners (checked when scheduling and again when each post runs).
`SetAnyPillarRule` switches a platform's "any pillar" rule for "Post for
me" (made switched off first when missing). `ArchiveDraft` archives a draft
and cancels its waiting posts.

**Reads (`queue_page.go`, `draft_page.go`, `job_list.go`,
`activity_list.go`, `plan.go`):** a post cut off while sending is listed
and counted as needing attention ("interrupted") at once; reading writes
nothing. `CurrentPlanPillars` reads the newest `marketing_plans` row's
pillar names only.

**API** (owners act, checked here and again in the transaction; members
read; the publishing-changes limit: 120 per 10 minutes per person; every
refusal worded as the old pages worded it):
- `GET /api/v1/cofounder/queue` → `{counts: {queued, publishing, published,
  failed, canceled, needs_attention}, waiting, needsAttention, failed,
  published, canceled: [post], rules: [{id, platform, pillar, enabled,
  createdAt, createdByName, enabledAt, enabledByName}], pillars: [name],
  activity: [entry], canManage, isBusy}`. A post: `{id, status,
  scheduledFor, runAfter, attempts, lastError, publishedAt, externalUrl,
  approvalMode, approvedVersion, updatedAt, draftId, draftTopic,
  draftPlatform, draftFormat, connectionId, connectionName,
  connectionStatus, connectionIsStandIn, createdByName, canceledByName,
  ruleEnabled, scheduledAgain}`. An entry: `{id, action, code, createdAt,
  actorUserId, actorName, draftId, draftTopic, draftPlatform, jobId,
  connectionPlatform, connectionName, rulePlatform, rulePillar,
  planVersion}`. Waiting and needing attention: up to 200; the others the
  newest 50; activity the newest 200.
- `GET /api/v1/cofounder/publishing/drafts/{id}` → `{jobs: [post] (the
  newest 100), accounts: [{id, displayName, isStandIn, status,
  hasLiveJob}], formatPublishable, coveringRule: {platform, pillar} |
  null, activity: [entry], canManage, isBusy}`; 404 for no such draft.
- `POST /api/v1/cofounder/publishing/drafts/{id}/schedule` `{version,
  connectionIds: [id] (1-20), when: "now" | "later", scheduledFor: "<UTC
  ISO time ending in Z>" (later), withoutApproval}` → `{outcome:
  "scheduled", jobIds, mode: "owner" | "auto_rule"}`; posts due already go
  out right after. 400 with `fields` (connectionIds, when, scheduledFor:
  "That time has passed: pick a later one, or Now.", "Pick a time within
  the next year."), 403, 404, 409 (stale, not-approved, blocked,
  already-scheduled, ...), 429.
- `POST /api/v1/cofounder/queue/jobs/{id}/cancel | publish-now | retry |
  mark-published | mark-not-published` (mark-published: `{url}`, optional)
  → `{outcome: "changed"}` (retry: `"retried"`); Publish now and Retry
  send right after. 400 (`fields.url`: "Paste the post's address on
  Facebook (https://...), or leave it empty."), 403, 404, 409 (changed
  meanwhile, or a retry's refusal), 429.
- `POST /api/v1/cofounder/queue/rules` `{platform, pillar}` (a pillar of
  the current plan by name, any case, or "" = any) → `{outcome: "created",
  ruleId}`; 400 (`fields.platform`, `fields.pillar`), 403, 409 (exists), 429.
- `POST /api/v1/cofounder/queue/rules/{id}` `{enabled}` → `{outcome:
  "changed" | "unchanged"}`; the screens ask first before switching one on.

**Logging:** "publishing: failed / delayed / held back / needs attention"
with a code only, "publishing: run after the answer failed" with the
error's type; never a token, the post's text, a file's key or a
platform's words.

**Tests:** `check_test.go`, `content_test.go` (every platform's rules, the
formats ansa publishes, post addresses, schedule times); `publishing_test.go`
(a fake Facebook: a rule's post to the stand-in, a real Page, slow-downs,
a refused token, a changed draft, a cut-off post); `runs_test.go` (five
runners send once, a lost run writes nothing, a run too slow, the daily
limit, five slow-downs, no post in the log, no time left);
`schedule_test.go`; `actions_test.go`; `owner_rules_test.go` (also:
nothing turns a rule on by itself); `image_test.go`; `facebook_test.go` (a
fake Graph API); `queue_page_test.go`. Every test person has an id as
Better Auth makes them (never cast to a uuid). API: `api/cofounder_queue_test.go`.
