# strategy: the marketing plan (core/internal/strategy, brain/brain/cofounder/plan*.py)

**What:** the Co-Founder's marketing plan and the Strategy page (the old
`lib/marketing-plan/`, `db/marketing-plans.ts`, `db/support-trends.ts`,
`db/cofounder-settings.ts`, `services/marketing-plan*.ts`,
`marketing-strategy.ts`, and the plan's half of
`lib/performance-review/past-performance.ts`). Tables: `marketing_plans`,
`companies.cofounder_uses_support_trends`, `cofounder_activity` (no migration).

**Making a plan (`make.go`, `inputs.go`):** owners only. The brain is
never asked until "What the business does", "Products" or "Services", and
"Target customers" are confirmed (`readiness.go`; a proposal never counts);
the `marketing-plans` limit (10 an hour per company) counts only once a plan
can be made. The request (`POST /v1/cofounder/marketing-plan`) holds ONLY:
the confirmed facts with their labels (never a proposal), the unconfirmed
topics, the approved articles ticked for marketing that match the
products, services and goals facts (`knowledge.CombineSearchTexts`: the
three take turns at the search's 20 words; whole pieces within 6,000
characters; never a draft, archived or support-only article), the owner's
note, the newest performance review (`pastperformance.go`: only what it
kept, each cited number with the post or group it names, never the review's
whole input; a review this code can't read is left out) and, only while
the owner's setting is on, ticket counts per category of the last 30 days
(names and numbers only). Nothing about the account.

**The brain:** the old prompt word for word: every value escaped, card-like
and social-security-like numbers hidden in the facts, the note and the
review's texts (articles and category names go as written). One long try:
effort high, 16,000 tokens, 270 s, no retry. Its answer is checked for the
plan's exact shape (`plan_answer.py`: every field, at every level, nothing
else, platforms and bases from their lists).

**Reading a plan (`planread.go`, `ReadPlan`), one reader for the brain's
answer AND a stored plan:** strict JSON (an unknown or missing field, a
wrong type, an unknown platform or basis, a cadence outside 0-14 = unusable);
texts one plain line, cut at a word with "..." (UTF-16, as the old code);
lists keep their first entries (audiences 1-5, goals 1-6, pillars 3-6 with
1-6 example topics, campaigns 1-6, cadence 1-4, statements 1-20, missing
information and cautions up to 10); posts a week rounded to one decimal;
blank, repeated and zero entries drop; too few = unusable. Then the fact
rule (`ApplyFactBasisRule`): a "fact" counts only when it names facts and
every one was among the confirmed facts sent; otherwise it is an
assumption, and each statement keeps only topics that were sent (at most
5). It runs on save AND on every read, against the plan's own facts_used.

**Saving (`store.go`):** under the company row lock (first), the maker read
again FOR SHARE as an owner; the version is the newest + 1 (two plans at
once get 1 and 2); every column named; a `plan_created` activity row with
the version, in the same transaction. Versions are never deleted. A
failed, refused, cut-off or unusable answer saves nothing.

**The page (`page.go`):** the current plan with who made it, its note, the
facts it was made from (labels), its articles (titles now; a deleted one has
none), whether it read support trends and which review, and whether the
confirmed facts changed since; the newest 50 versions; what a plan still
needs; the setting. A version's own page by its number (only a claim).

**API ([api](api.md)):**
- `GET /api/v1/cofounder/strategy` → `{strategy: {current: ShownPlan | null, newestVersion, versions: [{version, createdAt, createdByName, factCount}], missingForPlan: [{label, topics}], usesSupportTrends}, canManage}`.
  `ShownPlan` = `{version, createdAt, createdByName, goalNote, content: Plan | null, factsUsed: [{topic, label, value}], knowledgeUsed: [{articleId, title | null}], usedSupportTrends, pastPerformance: {reviewedAt, periodStart, periodEnd} | null, profileChangedSince}`;
  `Plan` has the stored keys (`summary`, `audiences`, `positioning`, `goals`, `pillars`, `campaigns`, `cadence`, `statements`, `missing_information`, `cautions`).
- `GET /api/v1/cofounder/strategy/versions/{version}` → `{plan: ShownPlan, newestVersion}`; 404 for another company's or an unknown one.
- `POST /api/v1/cofounder/strategy/plan` `{goalNote}` (0-1,000) → `{version}`; 409 `{error, missing}` until the facts it needs are confirmed; 429; 502 with why no plan came (unavailable, unusable, failed). Waits up to 295 s.
- `POST /api/v1/cofounder/strategy/support-trends` `{useSupportTrends}` → `{outcome: "changed" | "unchanged"}` (owners, `settings-changes` limit).

**Tests:** `plan_test.go` (cut to size, never refused for length; another
shape unusable; the fact rule; readiness; the search taking turns);
`strategy_test.go` (only confirmed facts, marketing articles, the note;
nothing about the account; the page; the activity row; versions 1-2-3 at
once, per company; owners only); `inputs_test.go` (support trends only
while on; the newest review's cited numbers; an unreadable review left
out; failed and unusable answers save nothing); `api/cofounder_strategy_test.go`;
`brain/tests/test_cofounder_plan.py`.
