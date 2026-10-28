import "server-only";
import { claimNextPostForMetrics, hasPostDueForMetrics, recordMetricsFailure, saveCollectedMetrics, type MetricsClaim, type MetricsScope } from "@/db/post-metrics";
import { platformsCollectingMetrics } from "@/lib/metric-definitions";
import type { MetricsErrorCode } from "@/lib/metrics-errors";
import { describeErrorWithFrames } from "@/lib/safe-error-logging";
import { fetchPostMetrics, LONGEST_METRICS_FETCH_MS } from "@/lib/social-publishing";
import { resolveSocialOptions, type SocialOptions } from "./social-options";
import { LONGEST_PREPARATION_MS, prepareConnectionForUse, type ConnectionForUse } from "./social-tokens";

// Reading the numbers of the Co-Founder's published posts (step 42): each
// post about once a day for 30 days after it went out, X's for 28
// (lib/metric-definitions.ts; db/post-metrics.ts says which are due), from
// the daily job and from /api/cron/publish. One post at a time: claimed,
// its account made ready (renewed if need be; one needing a
// reconnect is skipped with its reason, nothing asked), its platform asked
// once (lib/social-publishing.ts), and what came back saved: a snapshot,
// or the failure's code on the job, never a snapshot of made-up numbers.
// Never a development stand-in's post: its numbers come from
// pnpm simulate:post-metrics only.
//
// LOGGING RULE for this file: fixed lines with platforms and codes only,
// never a token, a post or anything a platform wrote.

// The time the routes these runs live in may take (maxDuration: the daily
// job and /api/cron/publish), counted from the start of the request.
export const METRICS_RUN_BUDGET_MS = 300_000;

// Room for one post's own database work: a query may wait 10 seconds for a
// free connection (db/client.ts).
const DATABASE_ALLOWANCE_MS = 10_000;

// The longest one post can take: the account made ready (waiting for
// another run's renewal, or renewing), the platform's one answer, the
// database. A post is started only while this still fits.
export const LONGEST_METRICS_RUN_MS = LONGEST_PREPARATION_MS + LONGEST_METRICS_FETCH_MS + DATABASE_ALLOWANCE_MS;

// The most posts one daily job reads, and one call of /api/cron/publish
// (a scheduler may call it every minute: posts first, a few numbers after).
export const DAILY_METRICS_BATCH = 100;
export const PINGED_METRICS_BATCH = 10;

// collected: a snapshot saved. failed: the platform refused or didn't
// answer. skipped: nothing was asked (the account needs a reconnect, or
// ansa can't read that platform's numbers now).
export type MetricsRunCounts = { collected: number; failed: number; skipped: number };

export type MetricsRunOptions = {
  social?: SocialOptions;
  batchSize?: number;
  // Only the checks pass it: they keep to their own companies.
  onlyCompanyIds?: string[];
};

type PostOutcome = keyof MetricsRunCounts;

// Reads the numbers of due posts of every company, one after another, while
// another still fits in the request's 300 seconds from jobStartedAt, at
// most batchSize. Never throws.
export async function collectPostMetrics(jobStartedAt = Date.now(), options: MetricsRunOptions = {}): Promise<MetricsRunCounts> {
  const counts: MetricsRunCounts = { collected: 0, failed: 0, skipped: 0 };
  const scope: MetricsScope = { platforms: platformsCollectingMetrics(), onlyCompanyIds: options.onlyCompanyIds };
  try {
    for (let started = 0; started < (options.batchSize ?? DAILY_METRICS_BATCH); started++) {
      if (Date.now() + LONGEST_METRICS_RUN_MS > jobStartedAt + METRICS_RUN_BUDGET_MS) {
        await sayIfPostsAreLeft("time limit", scope);
        return counts;
      }
      const claim = await claimNextPostForMetrics(scope);
      if (!claim) {
        return counts;
      }
      counts[await collectClaimedPost(claim, options)] += 1;
    }
    await sayIfPostsAreLeft("batch size", scope);
  } catch (error) {
    console.error(`Post metrics run failed: ${describeErrorWithFrames(error)}`);
  }
  return counts;
}

// One claimed post: its account made ready, its platform asked, the answer saved.
async function collectClaimedPost(claim: MetricsClaim, options: MetricsRunOptions): Promise<PostOutcome> {
  try {
    const connection = await prepareConnectionForUse(claim.companyId, claim.connectionId, options.social);
    if (connection.kind !== "ready") {
      return skip(claim, codeForAccount(connection));
    }
    const resolved = resolveSocialOptions(options.social ?? {});
    const request = { externalPostId: claim.externalPostId, publishedAt: claim.publishedAt };
    const result = await fetchPostMetrics(connection, connection.target, request, resolved.modeOf(connection.platform), { fetchFn: resolved.fetchFn, now: resolved.now });
    if (result.kind === "collected") {
      await saveCollectedMetrics(claim.companyId, claim.jobId, result.values);
      return "collected";
    }
    if (result.kind === "unavailable") {
      return skip(claim, result.code);
    }
    console.warn(`Post metrics not collected: ${claim.platform} ${result.code}`);
    const tokenRejected = result.code === "token_rejected" ? { storedAccessToken: connection.storedAccessToken } : null;
    await recordMetricsFailure(claim.companyId, claim.jobId, result.code, tokenRejected);
    return "failed";
  } catch (error) {
    // Its claim stays: the post is due again in a day.
    console.error(`Post metrics run failed: ${describeErrorWithFrames(error)}`);
    return "failed";
  }
}

// Nothing was asked: the reason, on the job.
async function skip(claim: MetricsClaim, code: MetricsErrorCode): Promise<PostOutcome> {
  console.warn(`Post metrics skipped: ${claim.platform} ${code}`);
  await recordMetricsFailure(claim.companyId, claim.jobId, code, null);
  return "skipped";
}

// Why the account couldn't be used, as a code of lib/metrics-errors.ts.
function codeForAccount(connection: Exclude<ConnectionForUse, { kind: "ready" }>): MetricsErrorCode {
  switch (connection.kind) {
    case "needs_reauth":
      return "reauthorization_needed";
    case "disconnected":
    case "not_found":
      return "account_disconnected";
    case "unavailable":
      if (connection.code === "refresh_unavailable") {
        return "token_refresh_unavailable";
      }
      return connection.code === "not_set_up" ? "not_set_up" : "account_unreadable";
  }
}

// One fixed line when a run stops at its limit with posts still due: the
// next run reads them, and a line that keeps coming means they wait long.
async function sayIfPostsAreLeft(limit: "time limit" | "batch size", scope: MetricsScope): Promise<void> {
  if (await hasPostDueForMetrics(scope)) {
    console.warn(`Post metrics run stopped at its ${limit}: posts are left for the next run`);
  }
}
