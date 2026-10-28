// The settings of each use of Claude (adapters/claude.ts, the only file that
// talks to Anthropic, has one function per use and sends these): effort,
// room for the answer, and time limits, one object per use, so tuning one
// never changes another.

export type RequestSettings = {
  effort: "low" | "medium" | "high";
  // Thinking tokens count toward this, so leave room beyond the short JSON answer.
  maxTokens: number;
  // Per attempt. The SDK retries 429, 5xx, network errors and timeouts, so
  // one request can take timeoutMs x (maxRetries + 1), plus the waits between
  // attempts (longestRequestMs). That must fit in the 300 seconds
  // (maxDuration) of the routes whose after() work waits for it, and of the
  // pages whose server actions do (the Co-Founder's Interview, Profile and
  // Strategy, the content studio's new draft and draft pages, the calendar
  // and Analytics).
  timeoutMs: number;
  maxRetries: number;
};

// The call decision: a wrong "solved" is the expensive mistake, so Claude
// thinks it through. At most about 3 minutes.
export const CALL_DECISION_SETTINGS: RequestSettings = { effort: "high", maxTokens: 8_000, timeoutMs: 60_000, maxRetries: 2 };

// Email triage: a summary, a subject and a category, no "solved" to protect.
// Less thinking, and a slow answer is retried once, not twice: at most about
// 1.5 minutes, after fetching the email from Resend (up to about a minute).
export const EMAIL_TRIAGE_SETTINGS: RequestSettings = { effort: "medium", maxTokens: 4_000, timeoutMs: 45_000, maxRetries: 1 };

// One turn of the Co-Founder's interview (step 36): the owner waits on the
// page for the next question, and a wrong reading only becomes a proposal
// the owner must confirm. So little thinking, a short answer, and one retry:
// at most about 1.5 minutes.
export const ONBOARDING_TURN_SETTINGS: RequestSettings = { effort: "low", maxTokens: 3_000, timeoutMs: 40_000, maxRetries: 1 };

// "Suggest facts from knowledge" (step 36): reading a whole article against
// every topic of the profile takes more thought than one interview answer.
// Proposals only, and the owner waits on the page: at most about 1.6 minutes.
export const FACT_SUGGESTION_SETTINGS: RequestSettings = { effort: "medium", maxTokens: 4_000, timeoutMs: 45_000, maxRetries: 1 };

// A marketing plan (step 37): the whole plan in one answer, so Claude thinks
// it through (effort high) with room to write it (16,000 tokens, thinking
// included). One long try, no retry: a plan takes Claude minutes, and a
// second try after a timeout could never finish in what is left of the
// Strategy page's 300 seconds. At most 4.5 minutes.
export const MARKETING_PLAN_SETTINGS: RequestSettings = { effort: "high", maxTokens: 16_000, timeoutMs: 270_000, maxRetries: 0 };

// A content draft (step 38): one post and its claims, a video script at
// most. Less thinking than a plan (effort medium), room for the script, and
// one retry, as the person waits on the studio's page: two tries of 2
// minutes, at most about 4 minutes 8 seconds of the page's 300.
export const CONTENT_DRAFT_SETTINGS: RequestSettings = { effort: "medium", maxTokens: 12_000, timeoutMs: 120_000, maxRetries: 1 };

// "Plan the next 2 weeks" on the calendar (step 41): topics, days and times
// for a few dozen posts, none of them written. Less room than a draft, some
// thought to spread them over the days (effort medium), and one retry as
// the owner waits on the calendar page: at most about 3 minutes 8 seconds.
export const CALENDAR_PLAN_SETTINGS: RequestSettings = { effort: "medium", maxTokens: 6_000, timeoutMs: 90_000, maxRetries: 1 };

// "Review performance" on the Analytics page (step 42): reading up to 100
// posts' numbers and their groups for findings that cite them, so some
// thought (effort medium) and room for the evidence lists, and one retry
// as the owner waits on the page: two tries of 2 minutes, at most about
// 4 minutes 8 seconds of its 300.
export const PERFORMANCE_REVIEW_SETTINGS: RequestSettings = { effort: "medium", maxTokens: 8_000, timeoutMs: 120_000, maxRetries: 1 };

// The SDK waits at most this long between attempts by default. A 429's
// retry-after can ask for much longer, and the SDK waits that long.
const SDK_LONGEST_WAIT_BETWEEN_ATTEMPTS_MS = 8_000;

// The longest one request with these settings can take: every attempt runs
// out of time, with the SDK's longest default wait between attempts. askClaude
// cuts the request off there, whatever retry-after asks, so this is a real
// limit: the scheduled job uses it to know when it may still start one
// (services/stuck-work.ts).
export function longestRequestMs(settings: RequestSettings): number {
  return settings.timeoutMs * (settings.maxRetries + 1) + settings.maxRetries * SDK_LONGEST_WAIT_BETWEEN_ATTEMPTS_MS;
}

