// When the publishing queue (step 41) tries a post again after a platform
// asked it to slow down (a 429). Pure.

const SHORTEST_WAIT_SECONDS = 30;
const LONGEST_WAIT_SECONDS = 24 * 60 * 60;

// Seconds from now until the next try: what the platform asked for (its
// retry-after, or when its limit resets) when it said, within 30 seconds
// and a day; otherwise 1, 2, 4, then 8 minutes after the first, second,
// third and fourth try.
export function secondsUntilNextTry(attempt: number, retryAfterSeconds: number | undefined): number {
  if (retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds)) {
    return Math.min(Math.max(Math.ceil(retryAfterSeconds), SHORTEST_WAIT_SECONDS), LONGEST_WAIT_SECONDS);
  }
  return 60 * 2 ** Math.min(Math.max(attempt - 1, 0), 10);
}
