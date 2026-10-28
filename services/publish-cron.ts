import "server-only";
import { isCorrectCronSecret } from "@/lib/cron-secret";
import { env } from "@/lib/env";
import { getClientIpFromHeaders } from "@/lib/request-ip";
import { describeErrorWithFrames } from "@/lib/safe-error-logging";
import { collectPostMetrics, PINGED_METRICS_BATCH, type MetricsRunCounts } from "./post-metrics-collection";
import { runDuePublishJobs, type PublishRunCounts } from "./publish-runs";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// /api/cron/publish (step 41): any scheduler calls it, as often as every
// minute (Vercel Pro's cron, or an outside pinger; docs/going-live.md),
// with "Authorization: Bearer <CRON_SECRET>". It runs the publishing
// queue's due posts of every company (services/publish-runs.ts), then
// reads a few published posts' numbers (step 42), so they spread over the
// day. Vercel Hobby allows only daily crons, so there the daily job runs
// both instead.

// Answers one call: 404 when no CRON_SECRET is set, 401 for a wrong or
// missing secret, 429 past the per-IP limit, otherwise runs the queue, then
// the numbers with what is left of the time, and says what came of both.
// Never throws. cronSecret, run and collectMetrics are only passed by the
// checks (fakes: the checks never publish or read another company's posts).
export async function handlePublishCronRequest(
  request: Request,
  cronSecret = env.CRON_SECRET,
  run: (jobStartedAt: number) => Promise<PublishRunCounts> = runDuePublishJobs,
  collectMetrics: (jobStartedAt: number) => Promise<MetricsRunCounts> = (startedAt) => collectPostMetrics(startedAt, { batchSize: PINGED_METRICS_BATCH }),
): Promise<Response> {
  // The route's 300 seconds count from here.
  const jobStartedAt = Date.now();
  try {
    if (!cronSecret) {
      return new Response(null, { status: 404 });
    }
    // The secret first, as the webhooks check their signature first. WHY:
    // the per-IP count is the scheduler's own. An outside pinger calls from
    // addresses its other customers share, and their calls without the
    // secret must not use it up (a refusal costs one compare and one line).
    if (!isCorrectCronSecret(request.headers.get("authorization"), cronSecret)) {
      console.warn("Publish run rejected: invalid secret");
      return new Response(null, { status: 401 });
    }
    if (await isOverRateLimit("publish-cron", getClientIpFromHeaders(request.headers), RATE_LIMITS.publishCronPerIp)) {
      return new Response(null, { status: 429 });
    }
    const published = await run(jobStartedAt);
    const metrics = await collectMetrics(jobStartedAt);
    return Response.json({ ...published, metrics }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    // No post text or token passes through here: the description and the
    // stack frames are logged (never the message).
    console.error(`Publish run failed: ${describeErrorWithFrames(error)}`);
    return new Response(null, { status: 500 });
  }
}
