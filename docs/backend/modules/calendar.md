# calendar: the calendar and "Plan the next 2 weeks" (core/internal/calendar, brain/brain/cofounder/calendar.py)

**What:** the Co-Founder's calendar page and its AI planning (the old
`services/calendar-planning.ts`, `db/content-calendar.ts`,
`lib/calendar-plan/` and the calendar half of
`services/publishing-pages.ts`). Tables: `content_drafts` (ideas with
`planned_for`), `publish_jobs` (read), `cofounder_activity` (no migration).

**The page (`page.go`):** the company's posts (publish jobs, but canceled
ones) due from a day ago to 29 days ahead, each at when it went out or is
due, its status as the pages show it (one cut off while sending needs
attention), with its account's name; and its drafts planned for a day that
aren't on their way (not scheduled, published, failed or archived). At most
500 of each, in time order; the browser puts each on the viewer's own day.
Plus the current plan's version and whether this person may plan (owners).

**Plan the next 2 weeks (`plan.go`, `answer.go`, `store.go`):** owners
only; needs a current marketing plan this code can read (else it says so
and asks nobody); the browser names its time zone; `calendar-plans` limit
(10 an hour per company), counted only once a plan exists. The request
(`POST /v1/cofounder/calendar-plan`) holds the 14 days from tomorrow in the
owner's time zone with their weekdays, each platform's target (its posts a
week for two weeks, rounded, at least one, at most 40 in all: the busiest
gives way first; the formats ansa publishes there), the plan's pillars and
campaigns, and the topics planned or scheduled on those days (at most 100).
No fact, account or id. The brain (effort medium, 6,000 tokens, 90 s, one
retry) answers posts in the plan's exact shape; core keeps each to what was
asked (`KeepPosts`): a day not planned, a platform without a target, an
empty topic, a repeat (also of one planned already), a post past its
platform's target or past 40 drop; an odd time is 09:00, a format the
platform doesn't take its first, a pillar or campaign name the plan doesn't
have none (the plan's own spelling otherwise). Each kept post becomes a
draft in status idea (topic, platform, format, pillar, campaign only;
nothing written, approved or scheduled) planned for its local day and time
(`WallClock`: a time a clock change skips moves past the jump, a repeated
one takes the first), with an `idea_planned` activity row, in ONE
transaction while the person is still an owner. Nothing usable = nothing saved.

**Note:** the activity rows are written here with the actor as text.
`publishing.RecordActivityWithin` casts the actor to `uuid`, which a real
(Better Auth) user id isn't; the test uses such an id.

**API ([api](api.md)):**
- `GET /api/v1/cofounder/calendar` → `{items: [{kind: "job" | "draft", id, at, draftId, topic, platform, format, status, accountName | null}], planVersion | null, canPlan}`.
- `POST /api/v1/cofounder/calendar/plan` `{timeZone}` → `{added}`; 400 no or an unknown time zone; 403 members; 409 no plan yet; 429; 502 with why nothing was added (unavailable, unusable, none fit, failed). Waits up to 240 s.

**Tests:** `answer_test.go` (wall clock around clock changes, days; the
targets within 40; posts kept to what was asked); `calendar_test.go` (no
plan = nobody asked; ideas at the owner's local time, nothing written; the
activity row by a real owner's id; a failed answer adds nothing; the page's
posts and ideas in order, canceled ones left out; members save nothing);
`api/cofounder_calendar_test.go`; `brain/tests/test_cofounder_calendar.py`.
