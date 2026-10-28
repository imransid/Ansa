// The numbers of the publishing queue and the calendar (step 41), in one
// small file the pages in the browser, the services, /db and the database's
// CHECKs (db/schema/publishing.ts) share.

// A job still "publishing" this long after a run claimed it was cut off
// while sending (one run takes at most about 4.5 minutes,
// services/publish-runs.ts): it may have gone out, so a person checks.
export const STALE_PUBLISHING_MINUTES = 10;

// Runs of one job before a platform's "slow down" (a 429) fails it. Each run
// that claims the job counts one (given back when the company's daily limit
// held it, or the run got too late to send); Retry starts again from none.
export const MAX_PUBLISH_ATTEMPTS = 5;

// A time typed a moment ago is still taken: filling in the form takes a
// while. Further back is refused, as is more than a year ahead.
export const SCHEDULE_PAST_GRACE_MS = 60_000;
export const SCHEDULE_MAX_AHEAD_DAYS = 365;

// The accounts one schedule may pick at once (a company has a few per platform).
export const SCHEDULE_ACCOUNTS_MAX = 20;

// When the company's daily limit holds a post back, it is tried again this
// much later (it waits in the queue, its tries untouched).
export const DAILY_LIMIT_WAIT_MINUTES = 60;

// The activity lists (the queue page, a draft's page) show the newest this many.
export const ACTIVITY_SHOWN = 200;

// The queue lists every waiting job and every one needing attention, and the
// newest this many of the failed, published and canceled ones.
export const FINISHED_JOBS_SHOWN = 50;

// The calendar shows this many days from today, in the viewer's timezone.
export const CALENDAR_DAYS = 28;

// "Plan the next 2 weeks": the days it plans, starting tomorrow, and the
// most ideas one plan adds (four platforms at a few posts a week each).
export const PLANNING_DAYS = 14;
export const PLANNED_IDEAS_MAX = 40;

// A post's address an owner types when marking a job published.
export const POST_URL_MAX_LENGTH = 2_000;
