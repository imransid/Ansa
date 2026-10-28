// The limits of the Co-Founder's marketing plans (step 37). Its own small
// file so the form in the browser, the plan's schema (plan-schema.ts), the
// prompt (plan-prompt.ts) and the database's CHECKs
// (db/schema/marketing-plans.ts) use the same numbers.

// What the owner asks one plan to focus on. A line break counts once, as in the box.
export const GOAL_NOTE_MAX_LENGTH = 1_000;

// How many entries each list of a plan may have: the fewest a usable plan
// needs, and the most that are kept (Claude is told both). A plan without
// its fewest is not saved; entries past the most are left out.
export const PLAN_LIST_LIMITS = {
  audiences: { min: 1, max: 5 },
  goals: { min: 1, max: 6 },
  pillars: { min: 3, max: 6 },
  exampleTopics: { min: 1, max: 6 },
  campaigns: { min: 1, max: 6 },
  cadence: { min: 1, max: 4 },
  formats: { min: 0, max: 5 },
  statements: { min: 1, max: 20 },
  factTopics: { min: 0, max: 5 },
  missingInformation: { min: 0, max: 10 },
  cautions: { min: 0, max: 10 },
} as const;

// The most posts a week a cadence may plan on one platform. More is no plan
// a small business keeps up with.
export const POSTS_PER_WEEK_MAX = 14;

// Support trends: the company's tickets per category over this many days.
export const SUPPORT_TREND_DAYS = 30;
// The most categories the trends list (a company keeps at most 100 active
// ones, plus any archived since that still had tickets).
export const SUPPORT_TREND_CATEGORIES_MAX = 100;

// How many knowledge hits a plan asks the search for: all it gives (10).
// The slice then keeps the best whole pieces within 6,000 characters
// (lib/knowledge/prompt-slice.ts), so a plan names at most 10 articles.
export const PLAN_KNOWLEDGE_HITS = 10;

// How many versions the Strategy page lists, newest first. Every version
// still opens from the one before or after it.
export const PLAN_VERSIONS_SHOWN = 50;

// The largest stored plan, as JSON text: far above what the lists and
// texts above can add up to, a safety net under the schema.
export const PLAN_JSON_MAX_LENGTH = 200_000;
