# publishing (core/internal/publishing, core/internal/drafts)

**What:** the publishing queue (the old `services/publish-*.ts`,
`db/publish-*.ts`, `lib/publishing/`): one post of one draft to one account
is a `publish_jobs` row. Today core publishes **Facebook text posts**, what
"Post for me" writes. Images, videos, LinkedIn, X and YouTube move with the
content studio and the media library; until then the old backend's runner
sends those (both runners claim jobs the same way, so a post is never sent
twice).

**Drafts (`core/internal/drafts`):** `Create` saves a new draft (version 1,
every column named; an "idea" when nothing is written; `Generated` = the
AI's text, `generated_version` 1), the person read again FOR SHARE.
`LockWithin` reads a draft with its row locked. `ClaimsChecked` is the old
`reviewDraft`'s "no owner needs to check the claims": the AI listed the
claims of exactly this text, in the stored shape, each backed by confirmed
facts that were sent and still say the same. A "Post for me" draft lists
none (ansa's own checks of its text replace them).

**The rules (`check.go`, pure):** `DecideSchedule` (when a post may be
scheduled: the version the page showed; an approval of this version by an
active owner, or the owner's tick "without an approval" AND an enabled rule
covering the platform and pillar whose maker and switcher are active
owners; the accounts the company's, connected, of the draft's platform; no
live post there already; no blocking problem; for a rule, no claim needing
an owner). `ReasonNotToPublish` decides it all AGAIN right before sending,
on one snapshot, never trusting how it was scheduled.

**Scheduling (`schedule.go`):** `Schedule` (owners only), ONE transaction:
the person FOR SHARE, the draft's row locked, the approver, the rule, the
accounts and the people behind them FOR SHARE, the confirmed facts now.
One job per account, the draft "scheduled", a "scheduled" activity row each
("auto_rule" for a rule's). A live job saved at the same moment = the
partial unique index = "already-scheduled".

**Running (`runner.go`, `claims.go`, `snapshot.go`, `outcomes.go`):** the
scheduler runs `RunDue` every 15 seconds ([schedule](schedule.md)). First,
posts cut off while sending (still "publishing" 10+ minutes after their
claim) go to a person: "needs_attention", "interrupted", NEVER sent again by
themselves (no platform offers a way to post only once). Then due posts are
CLAIMED one at a time in ONE UPDATE (a scalar `SKIP LOCKED` subquery, a new
`claim_id`, attempts + 1; listed in CROSS_COMPANY.md), the companies taking
turns, at most 50 a round. Each run: the snapshot (repeatable read, read
only) and the check; the company's daily limit (`publish-attempts`, 30 a
day, counted before the account is read: a held-back post costs nothing
more and waits an hour, its try given back); the Page read
([social](social.md) `PageForPosting`: only services decrypt tokens); the
claim checked once more (still held, and under 7 minutes old, so even the
slowest answer comes before it counts as cut off); then Facebook. Every
outcome is ONE transaction: the draft's row locked first, the job written
only while "publishing" under this run's claim id, the draft's status
following its jobs (`DraftStatusFromJobs`), the app's activity row.

**What a platform's answer does:** published → the post's id and address;
unclear (no answer, a 5xx, no id) → needs_attention, never sent again by
itself; rate_limited with attempts < 5 → queued again after what the
platform asked (30 s to a day) or 1, 2, 4, 8 minutes; token_rejected →
failed and the account marked "needs_reauth" while it still holds that
token (a reconnect meanwhile stands), with a "reconnect_needed" row; any
other refusal → failed with its code.

**Facebook (`facebook.go`):** `PublishToFacebook` posts to the Page's
`/feed` with `appsecret_proof`, 15 s, no redirects, at most 1 MB read; only
the id and the error code are read (Meta's words never). Codes: Meta's
error-handling guide (506 duplicate, 190 token_rejected, 10 / 200-299
permission_denied, 368 blocked_by_policy, 100 invalid_request, 1609005
link_error; throttling 4, 17, 32, 341, 613, 80001 with the
`X-Business-Use-Case-Usage` wait). NOT TESTED against Facebook: ansa's Meta
app needs App Review for pages_manage_posts first.

**Stand-in (`standin.go`):** in development the stand-in Page's posts are
files in `.dev-social/facebook/<time>-<job>.json` ("NOT published
anywhere"); production fails them "platform_not_set_up".

**Rules and archiving (`rules.go`):** `SetAnyPillarRule` switches a
platform's "any pillar" auto-publish rule on in an owner's name or off
(made switched off first when missing; "rule_created", "rule_enabled",
"rule_disabled" in the activity log): only an owner's explicit switch
calls it with on ("Post for me" in Automatic). `ArchiveDraft` archives a
draft (anyone active in the company; not a published one): its approval
gone and its waiting posts canceled ("draft_archived").

**Logging:** "publishing: failed / delayed / held back / needs attention"
with a code only; never a token, the post's text or a platform's words.

**Tests:** `check_test.go` (the run-time rules, a schedule under a rule);
`publishing_test.go` (live database, a fake Facebook: a rule's post goes to
the stand-in Page as a file and the draft follows, production refuses the
stand-in; a real Page gets the published text, a slow-down waits and keeps
its try, a refused token fails the post and marks the Page; a draft changed
after scheduling is never sent; a word to avoid blocks; a post cut off
while sending goes to a person; retry timing and draft status);
`drafts/claims_test.go`.
