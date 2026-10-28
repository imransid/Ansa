import "server-only";
import { deleteExpiredOauthStates, deleteExpiredSessions, deleteExpiredVerifications, deleteOldRateLimitCounters } from "@/db/maintenance";
import { isCorrectCronSecret } from "@/lib/cron-secret";
import { env } from "@/lib/env";
import { getClientIpFromHeaders } from "@/lib/request-ip";
import { describeErrorWithFrames } from "@/lib/safe-error-logging";
import { collectPostMetrics, type MetricsRunCounts } from "./post-metrics-collection";
import { runDuePublishJobs, type PublishRunCounts } from "./publish-runs";
import { isOverRateLimit, longestRateLimitWindowSeconds, RATE_LIMITS } from "./rate-limit";
import { recoverStuckWork, type RecoveryCounts } from "./stuck-work";

// Rate limit counters are kept this much longer than the longest window
// (services/rate-limit.ts), so the cleanup never resets a counter that is
// still counting, even if clocks disagree a little.
const RATE_LIMIT_COUNTER_SLACK_SECONDS = 24 * 60 * 60;

// One delete statement removes at most this many rows (db/maintenance.ts
// says why in batches), and each table gets at most this long per run: the
// same request then runs stuck work, within the route's 300 seconds. What is
// left waits for the next run (a delete cut off by the host is harmless too).
const CLEANUP_BATCH_SIZE = 10_000;
const CLEANUP_SECONDS_PER_TABLE = 10;

export type CleanupCounts = {
  rateLimitCounters: number;
  sessions: number;
  verifications: number;
  oauthStates: number;
};

// Only the checks change these, to try small batches and a used-up time budget.
export type CleanupOptions = { batchSize?: number; secondsPerTable?: number };

// Deletes one batch of at most `limit` old rows of one table, and says how many.
type DeleteBatch = (limit: number) => Promise<number>;

// Answers the scheduled call: 404 when no CRON_SECRET is set, 401 for a
// wrong or missing secret (never counted: see handlePublishCronRequest),
// 429 past the per-IP limit, otherwise sends the publishing queue's due
// posts (step 41: on Vercel Hobby, a daily cron is all there is;
// /api/cron/publish does it as often as a scheduler calls), runs the
// cleanup, then runs again the emails and calls whose work never finished
// (step 27), then reads the numbers of published posts (step 42), each
// with what is left of the time. Never throws. cronSecret, recover,
// cleanup, publish and collectMetrics are only passed by the checks (fakes:
// the checks never call Claude, Resend or a platform, nor touch another
// company's posts).
export async function handleCleanupRequest(
  request: Request,
  cronSecret = env.CRON_SECRET,
  recover: (jobStartedAt: number) => Promise<RecoveryCounts> = recoverStuckWork,
  cleanup: () => Promise<CleanupCounts> = runCleanup,
  publish: (jobStartedAt: number) => Promise<PublishRunCounts> = runDuePublishJobs,
  collectMetrics: (jobStartedAt: number) => Promise<MetricsRunCounts> = collectPostMetrics,
): Promise<Response> {
  // The route's 300 seconds count from here: the cleanup and the stuck work
  // after the posts only get what the posts left of them.
  const jobStartedAt = Date.now();
  try {
    if (!cronSecret) {
      return new Response(null, { status: 404 });
    }
    if (!isCorrectCronSecret(request.headers.get("authorization"), cronSecret)) {
      console.warn("Cleanup rejected: invalid secret");
      return new Response(null, { status: 401 });
    }
    if (await isOverRateLimit("cron", getClientIpFromHeaders(request.headers), RATE_LIMITS.cronPerIp)) {
      return new Response(null, { status: 429 });
    }
    // Posts first. WHY: they are due at a time, and a run starts one only in
    // its first ~30 seconds (services/publish-runs.ts), which a long cleanup
    // or one stuck call would use up. The cleanup is capped per table, and
    // stuck work starts an item only while its slowest run still fits.
    const published = await publish(jobStartedAt);
    const deleted = await cleanup();
    const retried = await recover(jobStartedAt);
    // Last: a post's numbers can wait a day, a customer's email can't.
    const metrics = await collectMetrics(jobStartedAt);
    return Response.json({ ...deleted, retried, published, metrics }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    // No customer data passes through here, so the Postgres code, the
    // constraint and the stack frames are logged too (never the message).
    console.error(`Cleanup failed: ${describeErrorWithFrames(error)}`);
    return new Response(null, { status: 500 });
  }
}

// Deletes data nobody can use any more, in batches, at most 10 seconds per
// table. Safe to run any number of times. Returns how many rows went.
export async function runCleanup(options: CleanupOptions = {}): Promise<CleanupCounts> {
  const counterAgeSeconds = longestRateLimitWindowSeconds() + RATE_LIMIT_COUNTER_SLACK_SECONDS;
  return {
    rateLimitCounters: await deleteInBatches("rate limit counters", (limit) => deleteOldRateLimitCounters(counterAgeSeconds, limit), options),
    sessions: await deleteInBatches("sessions", deleteExpiredSessions, options),
    verifications: await deleteInBatches("verification links", deleteExpiredVerifications, options),
    oauthStates: await deleteInBatches("social connection attempts", deleteExpiredOauthStates, options),
  };
}

// Repeats one table's batch delete until a batch comes back short (nothing
// old is left) or the table's time is up, which it logs so a growing backlog
// is noticed. Returns how many rows went.
async function deleteInBatches(table: string, deleteBatch: DeleteBatch, options: CleanupOptions): Promise<number> {
  const batchSize = options.batchSize ?? CLEANUP_BATCH_SIZE;
  const stopAt = Date.now() + (options.secondsPerTable ?? CLEANUP_SECONDS_PER_TABLE) * 1000;
  let deleted = 0;
  while (true) {
    const deletedNow = await deleteBatch(batchSize);
    deleted += deletedNow;
    if (deletedNow < batchSize) {
      return deleted;
    }
    if (Date.now() >= stopAt) {
      console.warn(`Cleanup stopped at its time limit: old ${table} are left for the next run`);
      return deleted;
    }
  }
}
