// Publishing queue checks (step 41), the runners: /api/cron/publish
// refuses without the secret (and never counts those calls against the
// scheduler's), stays a thin route that runs on every request; the daily
// job sends due posts too, before its cleanup and stuck work, on the same
// clock; a post is started only while its longest run still fits in the
// 300 seconds, and a run that stops with posts still due says so. Fake
// runs and fake platforms only.

import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import { API_TIMEOUT_MS } from "@/lib/social-http";
import { LONGEST_PUBLISH_MS } from "@/lib/social-publishing";
import { VIDEO_UPLOAD_TIMEOUT_MS } from "@/adapters/youtube-videos";
import { handleCleanupRequest } from "@/services/maintenance";
import { MEDIA_READ_TIMEOUT_MS } from "@/services/publish-attempt";
import { handlePublishCronRequest } from "@/services/publish-cron";
import { LONGEST_PUBLISH_RUN_MS, PUBLISH_RUN_BUDGET_MS, runDuePublishJobs, runPublishJobsNow } from "@/services/publish-runs";
import { RATE_LIMITS } from "@/services/rate-limit";
import { LONGEST_PREPARATION_MS } from "@/services/social-tokens";
import { captureConsole, check, runId } from "./helpers";
import { jobRow, linkedInPosted, makeDue, ownerWithApprovedDraft, realLinkedInAccount, scheduledJobIds, throughFakePlatform } from "./publishing-helpers";
import { read, withoutComments } from "./source-helpers";
import { fakePlatform } from "./social-helpers";

const NOTHING_RUN = { interrupted: 0, published: 0, failed: 0, needsAttention: 0, requeued: 0 };
// The routes read post numbers too (step 42): the checks pass a run that reads none.
const NO_METRICS = { collected: 0, failed: 0, skipped: 0 };
const noMetrics = async () => NO_METRICS;

export async function runPublishingCronChecks() {
  await check("publish route: off without a CRON_SECRET (404), refused with a wrong or missing one (401, one fixed log line, nothing run), runs the queue with it and says what came of it, never cached; past its hourly calls from one address, 429; calls without the secret count for nothing, so strangers sharing a pinger's address can't use up the scheduler's", async () => {
    const secret = `publish-secret-${runId}`.padEnd(40, "p");
    const runs: number[] = [];
    const fakeRun = async (jobStartedAt: number) => {
      runs.push(jobStartedAt);
      return { ...NOTHING_RUN, published: 2 };
    };
    const call = (authorization: string | null, cronSecret = secret, address = `publish-${runId}`) => {
      const headers: Record<string, string> = { "x-forwarded-for": address };
      if (authorization) {
        headers.authorization = authorization;
      }
      return handlePublishCronRequest(new Request("http://localhost/api/cron/publish", { headers }), cronSecret, fakeRun, noMetrics);
    };
    assert.equal((await call(`Bearer ${secret}`, "")).status, 404);
    const refused = await captureConsole(async () => [(await call(null)).status, (await call(`Bearer ${secret}x`)).status, (await call(secret)).status]);
    assert.deepEqual(refused.result, [401, 401, 401]);
    assert.deepEqual(refused.logs, ["Publish run rejected: invalid secret", "Publish run rejected: invalid secret", "Publish run rejected: invalid secret"]);
    const runsSoFar = (): number => runs.length;
    assert.equal(runsSoFar(), 0, "a refused call ran the queue");
    const answer = await call(`Bearer ${secret}`);
    assert.deepEqual([answer.status, answer.headers.get("cache-control"), await answer.json()], [200, "no-store", { ...NOTHING_RUN, published: 2, metrics: NO_METRICS }]);
    assert.ok(runsSoFar() === 1 && Date.now() - runs[0] < 5_000, "the run didn't get the call's start time");
    const busy = `publish-busy-${runId}`;
    let last = 0;
    for (let attempt = 0; attempt <= 300; attempt++) {
      last = (await call(`Bearer ${secret}`, secret, busy)).status;
    }
    assert.equal(last, 429);
    const shared = `publish-shared-${runId}`;
    const strangers = await captureConsole(async () => {
      const statuses: number[] = [];
      for (let attempt = 0; attempt <= 300; attempt++) {
        statuses.push((await call(null, secret, shared)).status);
      }
      return statuses;
    });
    assert.ok(strangers.result.every((status) => status === 401), "a call without the secret got past it");
    const runsBefore = runsSoFar();
    assert.equal((await call(`Bearer ${secret}`, secret, shared)).status, 200, "calls without the secret used up the scheduler's");
    assert.equal(runsSoFar(), runsBefore + 1);
  });

  await check("daily job: calls without the secret count for nothing too (401 each): the scheduler's own call from the same address still runs", async () => {
    const secret = `daily-shared-${runId}`.padEnd(40, "s");
    const nothingRun = async () => NOTHING_RUN;
    const noWork = async () => ({ emails: 0, calls: 0, generations: 0 });
    const noCleanup = async () => ({ rateLimitCounters: 0, sessions: 0, verifications: 0, oauthStates: 0 });
    const call = (authorization: string | null) => {
      const headers: Record<string, string> = { "x-forwarded-for": `daily-shared-${runId}` };
      if (authorization) {
        headers.authorization = authorization;
      }
      return handleCleanupRequest(new Request("http://localhost/api/cron/cleanup", { headers }), secret, noWork, noCleanup, nothingRun, noMetrics);
    };
    const strangers = await captureConsole(async () => {
      const statuses: number[] = [];
      for (let attempt = 0; attempt <= RATE_LIMITS.cronPerIp.maxAttempts; attempt++) {
        statuses.push((await call(null)).status);
      }
      return statuses;
    });
    assert.ok(strangers.result.every((status) => status === 401));
    assert.equal((await call(`Bearer ${secret}`)).status, 200, "calls without the secret used up the scheduler's");
  });

  await check("publish route: a thin GET that reads the request first (await connection()), so it runs on every request (ƒ in the build), with maxDuration 300; vercel.json keeps only the daily job (Vercel Hobby allows daily crons only)", async () => {
    const route = withoutComments(await read("app/api/cron/publish/route.ts"));
    assert.ok(route.trimEnd().split("\n").length <= 15, "the route grew past ~15 lines");
    assert.match(route, /export const maxDuration = 300;/);
    assert.match(route, /export async function GET\(request: Request\) \{\s*await connection\(\);\s*return handlePublishCronRequest\(request\);\s*\}/);
    assert.doesNotMatch(route, /from "@\/(db|adapters)\//);
    const vercel = JSON.parse(await read("vercel.json"));
    assert.deepEqual(vercel.crons, [{ path: "/api/cron/cleanup", schedule: "0 4 * * *" }]);
    const goingLive = await read("docs/going-live.md");
    assert.match(goingLive, /\/api\/cron\/publish/);
    assert.match(goingLive, /every minute/);
    await access(path.join(process.cwd(), "app/api/cron/publish/route.ts"));
  });

  await check("daily job: it sends due posts first (a run starts one only in its first ~30 seconds), then its cleanup, stuck work and the posts' numbers (step 42) get what is left, all on the same clock (counted from the start of the job), and says so", async () => {
    const secret = `daily-secret-${runId}`.padEnd(40, "d");
    const seen: { recover: number; publish: number; metrics: number; order: string[] } = { recover: 0, publish: 0, metrics: 0, order: [] };
    const cleanup = async () => {
      seen.order.push("cleanup");
      // A moment, as the real cleanup takes: a clock started after it would differ.
      await new Promise((resolve) => setTimeout(resolve, 25));
      return { rateLimitCounters: 0, sessions: 0, verifications: 0, oauthStates: 0 };
    };
    const recover = async (jobStartedAt: number) => {
      seen.order.push("recover");
      seen.recover = jobStartedAt;
      return { emails: 0, calls: 0, generations: 0 };
    };
    const publish = async (jobStartedAt: number) => {
      seen.order.push("publish");
      seen.publish = jobStartedAt;
      return { ...NOTHING_RUN, published: 1 };
    };
    const headers = { authorization: `Bearer ${secret}`, "x-forwarded-for": `daily-${runId}` };
    const calledAt = Date.now();
    const metrics = async (jobStartedAt: number) => {
      seen.order.push("metrics");
      seen.metrics = jobStartedAt;
      return { ...NO_METRICS, collected: 3 };
    };
    const answer = await handleCleanupRequest(new Request("http://localhost/api/cron/cleanup", { headers }), secret, recover, cleanup, publish, metrics);
    assert.equal(answer.status, 200);
    assert.deepEqual(seen.order, ["publish", "cleanup", "recover", "metrics"]);
    assert.ok(seen.publish === seen.recover && seen.publish === seen.metrics && seen.publish >= calledAt && seen.publish - calledAt < 1_000, "the posts, the stuck work and the numbers didn't share the job's clock");
    const body = await answer.json();
    assert.deepEqual([body.published, body.metrics], [{ ...NOTHING_RUN, published: 1 }, { ...NO_METRICS, collected: 3 }]);
  });

  await check("publish runs: a post is started only while its longest run (getting the account ready, reading its media, YouTube's upload, the database) still fits in the 300 seconds; one not started stays queued and due, and the run says in one fixed line that due posts are left", async () => {
    assert.equal(LONGEST_PUBLISH_MS, API_TIMEOUT_MS + VIDEO_UPLOAD_TIMEOUT_MS);
    assert.ok(LONGEST_PUBLISH_RUN_MS >= LONGEST_PREPARATION_MS + MEDIA_READ_TIMEOUT_MS + LONGEST_PUBLISH_MS && LONGEST_PUBLISH_RUN_MS < PUBLISH_RUN_BUDGET_MS, `${LONGEST_PUBLISH_RUN_MS} ms`);
    const { owner, draftId } = await ownerWithApprovedDraft("pub-budget");
    const account = await realLinkedInAccount(owner, `member${runId}bu`);
    const [jobId] = await scheduledJobIds(owner, draftId, [account]);
    await makeDue(jobId);
    const linkedIn = fakePlatform([linkedInPosted("urn:li:share:7000000000000000901")]);
    const options = { ...throughFakePlatform(linkedIn.fetchFn), onlyCompanyIds: [owner.companyId] };
    const startedWithTimeLeft = (leftMs: number) => Date.now() - (PUBLISH_RUN_BUDGET_MS - leftMs);
    const late = await captureConsole(() => runDuePublishJobs(startedWithTimeLeft(LONGEST_PUBLISH_RUN_MS - 1_000), options));
    assert.deepEqual([late.result, late.logs], [NOTHING_RUN, ["Publish run stopped at its time limit: due posts are left for the next run"]]);
    assert.deepEqual(await runPublishJobsNow(owner.companyId, [jobId], options, startedWithTimeLeft(LONGEST_PUBLISH_RUN_MS - 1_000)), []);
    assert.deepEqual([(await jobRow(jobId)).status, linkedIn.requests.length], ["queued", 0]);
    const inTime = await captureConsole(() => runDuePublishJobs(startedWithTimeLeft(LONGEST_PUBLISH_RUN_MS + 5_000), options));
    assert.deepEqual([inTime.result, inTime.logs], [{ ...NOTHING_RUN, published: 1 }, []]);
    assert.equal((await jobRow(jobId)).status, "published");
    // Nothing due is left now: a run out of time says nothing.
    assert.deepEqual((await captureConsole(() => runDuePublishJobs(startedWithTimeLeft(LONGEST_PUBLISH_RUN_MS - 1_000), options))).logs, []);
  });
}
