# analytics: the Analytics page and performance reviews (core/internal/analytics, brain/brain/analytics/review.py)

**What:** the Co-Founder's Analytics page, "Review performance" and the
development stand-in's simulated numbers (the old
`services/analytics-page.ts`, `services/performance-review.ts`,
`services/post-metrics-simulation.ts`, `db/post-metrics-reads.ts`,
`db/performance-reviews.ts`, `db/post-metrics-simulation.ts`,
`lib/analytics/`, `lib/performance-review/`, `lib/metric-definitions.ts`).
Reading the numbers from the platforms is [postmetrics](postmetrics.md);
the marketing planner reads the newest review through its own code, so
the stored columns keep the old JSON exactly.

**What each number means (`definitions.go`, pure):** the seven columns of
`post_metrics` (views, reach, reactions, comments, shares, clicks,
video_views), and per platform and column: `collected` (from a field the
research names), `needs_permission` (a permission ansa doesn't ask for:
LinkedIn's r_member_postAnalytics, Facebook's read_insights, YouTube's
yt-analytics.readonly) or `not_offered`, each with one line the page shows.
Numbers are read for 30 days after a post went out, X's for 28 (it gives
link clicks for 30 days only, and a read without them would hide the ones
read before). A number a platform doesn't give is NULL, never 0.

**The page (`page.go`, `store.go`, `problems.go`, `totals.go`, `notes.go`,
`describe.go`):** everyone in the company reads it. The period is 7, 30 or
90 days (anything else, none or several = 30), up to now. The period's
published posts (up to 3,000 counted, the newest 200 listed), each with its
newest snapshot (LATERAL: newest `collected_at`, then `created_at`), whether
its numbers are still read, and in words why it has none (`whyNoNumbers`:
a stand-in's, marked published by hand, LinkedIn, past the read days, the
last try's error, not read yet) or why the latest try read nothing
(`latestTryProblem`, never a promise past the read days). Totals per
platform (in the platforms' order): each number's sum over the posts that
have it and how many, else `not_offered`, `not_collected` (with the
permission) or `no_numbers_yet`; `simulated` when a simulated snapshot is
in it. The period's publishing problems: failed or needing attention (a
post still "publishing" 10+ minutes after its claim shows as
needs_attention, "interrupted"), by their last change, newest 50, in the
queue's job-list shape. When numbers were last tried, read and simulated.
The newest review with each cited number in words ("P5: “Post 5”,
LinkedIn text post, Monday 09:00", "Reactions", "8"); a row saved in a
shape this code can't read shows as unreadable. Every statement names the
company, every join matches company_id.

**Review performance (`review.go`, `reviewinput.go`, `check.go`,
`numbers.go`, `cleantext.go`, `reviewstore.go`):** owners only (checked
here, and the role read again FOR SHARE in the saving transaction:
`team.RoleWithin`). In this order: the period and the browser's time zone
(an IANA name this server knows; never "Local"), the owner, at least 5
posts with numbers in the period (else "A review needs at least 5 posts
with numbers in the period, and it has 4: 1 more is needed. Nothing was
sent to the AI."), then the limit `performance-reviews` (10 an hour per
company, the old counter, counted only once a review can be made). The
input (stored as `input_summary`, the old keys): the newest 100 posts with
numbers, labeled P1... in the order they went out, each with platform,
format, pillar, topic, weekday and HH:00 in the owner's zone and only the
numbers it has; groups G1... per platform, per pillar (sorted as
JavaScript sorts) and without a pillar, with posts, `<n>_total`,
`<n>_posts` and `<n>_per_post` (to one decimal). The brain gets the
period, counts, posts and groups only: no account, person, id or post text
but the topic. THIS CODE then keeps a finding only when every number it
cites equals the input's under that label and name and its text writes no
other number (after NFKC, in any script's digits; a time HH:MM and digits
of a cited topic or name aside; a cited value only in 0-9); a
recommendation only with a kept finding (renumbered) and only their
numbers; a limit only the input's numbers; at most 8, 6 (evidence), 6 and
5; texts one plain line cut at a word with "..." (500, limits 300, in
UTF-16 units as the old code counted). No finding left = nothing saved.

**The brain (`brain/brain/analytics/review.py`, `POST /v1/analytics/review`,
signed by core):** the old prompt, system rules and JSON schema word for
word: every text escaped in its tag, card-like and social-security-like
numbers hidden before the cut, topics and pillars cut to 200 UTF-16 units
with "[... N characters left out ...]". ansa's own key only (never a
business's), settings `ai.PERFORMANCE_REVIEW` (effort medium, 8,000
tokens, 120 s a try, 1 retry, as the old PERFORMANCE_REVIEW_SETTINGS). The
answer is read strictly (exactly its keys, at most 50 of each list, numbers
that are numbers, based_on_findings whole numbers): `{"kind": "ok",
"findings", "recommendations", "limits_of_this_data"}` or `{"kind":
"failed", "reason": "model_unavailable" | "model_failed" (with
`error_name`) | "unusable_answer"}`. Core's client waits up to 260 s.

**Simulated numbers (`simulate.go`, `go run ./cmd/simulate post-metrics`,
`make simulate-post-metrics JOB=<id> NUMBERS="views=120 reactions=8"`):**
development and a database on this computer only (the command's guard
first, then the service refuses production). It finds the post by its id
(the one cross-company read, in CROSS_COMPANY.md), refuses a real account's
post, one not published, a number its platform doesn't have ("X gives no
reach: leave it out."), an unknown, repeated, negative, decimal or too
large number and an id that isn't one, then saves a `dev_simulated`
snapshot (the numbers given, the rest NULL) with the post locked FOR
SHARE, company-scoped.

**API ([api](api.md)):**
- `GET /api/v1/cofounder/analytics?period=7|30|90` → 200 `{period,
  periodStart, periodEnd, posts: [{jobId, draftId, topic, platform, format,
  pillar, accountName, accountIsStandIn, publishedAt, hasPlatformId,
  metricsAttemptedAt, metricsError, latest: {collectedAt, source, values:
  {views, reach, reactions, comments, shares, clicks, video_views}} | null,
  numbersStillRead, whyNoNumbers, latestTryProblem}], postCount,
  postsWithNumbers, totals: [{platform, posts, postsWithNumbers, simulated,
  metrics: {<column>: {kind, value?, posts?, permission?}}}], problems:
  [{id, status, scheduledFor, runAfter, attempts, lastError, publishedAt,
  externalUrl, approvalMode, approvedVersion, updatedAt, draftId,
  draftTopic, draftPlatform, draftFormat, connectionId, connectionName,
  connectionStatus, connectionIsStandIn, createdByName, canceledByName,
  ruleEnabled, scheduledAgain}], activity: {lastAttemptAt,
  lastCollectedAt, lastSimulatedAt}, review: {madeAt, madeByName,
  periodStart, periodEnd, readable, postCount, simulated, findings: [{text,
  evidence: [{source, metric, value, simulated}]}], recommendations:
  [{text, basedOn}], limits} | null, postsNeededForReview, postsNeededText,
  canReview, readDays: {<platform>: days}, definitions: [{platform, label,
  metrics: [{column, columnLabel, status, label, field, definition,
  permission}]}]}` (the old page's fields, plus the notes, readDays and
  definitions).
- `POST /api/v1/cofounder/analytics/review` `{"period": "30", "timeZone":
  "Europe/Lisbon"}` (waits for the AI, up to 270 s) → 200 `{"outcome":
  "saved"}`; or `{"error": "<words>"}` with 400 (an unknown field, a body
  that can't be read, an odd period or time zone), 403 (not an owner), 409
  (fewer than 5 posts with numbers), 429 (the hourly limit) or 422 (no
  review: the AI unavailable, failed, an unusable answer, or no finding
  whose numbers checked out).

**Logging:** "claude call failed" with the class only (`BrainUnavailable`
when the brain didn't answer); never the numbers, topics, prompt, the AI's
answer or an error's text.

**Tests:** `definitions_test.go` (every platform's seven numbers, what is
collected, the read days, the notes never promising a read past them, the
totals adding only the numbers posts have); `check_test.go` (numbers in
any script's digits, the old answer check's valid and dropped findings,
recommendations and limits, the cut; a table of the old TypeScript's own
outputs for tricky texts, run with Node); `golden_test.go` (the input built
from tricky posts equals the old code's, `testdata/review_input.json`);
`page_test.go`, `review_test.go`, `simulate_test.go` (live database, a fake
brain: newest first, the periods, another company's posts and reviews
never shown, the problems, no AI below 5 posts, for a member, past the
limit or without a time zone, what the brain gets, exactly what the check
kept saved, every failure saving nothing); `api/cofounder_analytics_test.go`;
`cmd/simulate/main_test.go` (the guard and the usage, [commands](commands.md)); brain
`tests/test_analytics.py` (the prompt, rules and schema equal the old
ones, `tests/golden/performance_review.json`; the settings; the strict
reading; the reasons; only core's signed request with known numbers).
