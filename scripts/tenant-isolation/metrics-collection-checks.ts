// Post number checks (step 42), the collector: a published post of the
// last 30 days is read about once a day, from an hour after it went out;
// never a stand-in's post, one marked published by hand, an older one or
// another company's; an account needing a reconnect is skipped with its
// reason; a failure records its code on the post and makes no snapshot;
// two runs read a post once; a run keeps to its time and its batch. Fake
// platforms only.

import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { recordMetricsFailure, saveCollectedMetrics } from "@/db/post-metrics";
import { cofounderActivity, socialConnections } from "@/db/schema";
import { emptyMetricValues } from "@/lib/metric-definitions";
import { API_TIMEOUT_MS } from "@/lib/social-http";
import { DAILY_METRICS_BATCH, LONGEST_METRICS_RUN_MS, METRICS_RUN_BUDGET_MS, PINGED_METRICS_BATCH } from "@/services/post-metrics-collection";
import { handlePublishCronRequest } from "@/services/publish-cron";
import { markJobPublishedForSession } from "@/services/publish-job-actions";
import { LONGEST_PREPARATION_MS } from "@/services/social-tokens";
import { approvedTextPost, collectFor, lastTriedAgo, metricsState, realPost, snapshotRows, standInPost, wentOutAgo, xAccount, xNumbers } from "./analytics-helpers";
import { makeReadyForDrafts } from "./content-studio-helpers";
import { captureConsole, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { jobRow, makeDue, runNow, scheduledJobIds, throughFakePlatform } from "./publishing-helpers";
import { fakePlatform, json, noPlatform } from "./social-helpers";
import { read, withoutComments } from "./source-helpers";

const NOTHING = { collected: 0, failed: 0, skipped: 0 };

async function readyOwner(label: string) {
  const owner = sessionFor(await signUpTestOwner(label));
  await makeReadyForDrafts(owner);
  return owner;
}

export async function runMetricsCollectionChecks() {
  await check("metrics collection: a post of the last 30 days is read once it has been out an hour, its snapshot saving what X gave (what X left out stays null), and isn't asked again for 20 hours; the post's place in the queue (updated_at) doesn't move", async () => {
    const owner = await readyOwner("metrics-read");
    const account = await xAccount(owner);
    const jobId = await realPost(owner, "x", account, "1790000000000000101");
    const before = await jobRow(jobId);
    const x = fakePlatform([xNumbers({ impressions: 120, likes: 8, replies: 0, reposts: 2, quotes: 1, linkClicks: 5 })]);
    assert.deepEqual(await collectFor([owner.companyId], x.fetchFn), { ...NOTHING, collected: 1 });
    assert.deepEqual([x.requests.length, x.requests[0].url], [1, "https://api.x.com/2/tweets/1790000000000000101?tweet.fields=public_metrics,non_public_metrics"]);
    const [snapshot] = await snapshotRows(jobId);
    assert.deepEqual(
      [snapshot.source, snapshot.views, snapshot.reach, snapshot.reactions, snapshot.comments, snapshot.shares, snapshot.clicks, snapshot.videoViews],
      ["platform", 120, null, 8, 0, 3, 5, null],
    );
    const after = await jobRow(jobId);
    assert.deepEqual([after.metricsError, after.updatedAt.getTime()], [null, before.updatedAt.getTime()]);
    assert.ok(after.metricsAttemptedAt, "the try wasn't recorded");
    // Not again within 20 hours; once its last try is 21 hours old, again.
    assert.deepEqual(await collectFor([owner.companyId], noPlatform), NOTHING);
    await lastTriedAgo(jobId, 21);
    const again = fakePlatform([xNumbers({ impressions: 300, likes: 9, replies: 1, reposts: 2, quotes: 1, linkClicks: 7 })]);
    assert.deepEqual(await collectFor([owner.companyId], again.fetchFn), { ...NOTHING, collected: 1 });
    assert.deepEqual((await snapshotRows(jobId)).map((row) => row.views), [120, 300]);
  });

  await check("metrics collection: never a development stand-in's post (its numbers are simulated only), one marked published by hand (no id on the platform), one out for under an hour, one out for over 30 days, nor another company's", async () => {
    const owner = await readyOwner("metrics-never");
    const other = await readyOwner("metrics-never-other");
    const account = await xAccount(owner);
    const standIn = await standInPost(owner, `X stand-in ${runId}`, { platform: "x" });
    await wentOutAgo(standIn, 120);
    const tooNew = await realPost(owner, "x", account, "1790000000000000201", 10);
    const tooOld = await realPost(owner, "x", account, "1790000000000000202", 31 * 24 * 60);
    const unclearDraft = await approvedTextPost(owner, "x", `Unclear ${runId}`);
    const [unclear] = await scheduledJobIds(owner, unclearDraft, [account]);
    await makeDue(unclear);
    assert.equal(await runNow(owner, unclear, throughFakePlatform(fakePlatform([new Response(null, { status: 503 })]).fetchFn)), "needs_attention");
    assert.deepEqual(await markJobPublishedForSession(owner, { jobId: unclear, postUrl: "" }), { ok: true });
    await wentOutAgo(unclear, 120);
    const othersPost = await realPost(other, "x", await xAccount(other), "1790000000000000203");
    // Only the owner's company: the other one's post waits, untouched.
    assert.deepEqual(await collectFor([owner.companyId], noPlatform), NOTHING);
    for (const jobId of [standIn, tooNew, tooOld, unclear, othersPost]) {
      assert.deepEqual([await metricsState(jobId), (await snapshotRows(jobId)).length], [{ attemptedAt: null, error: null }, 0], jobId);
    }
    // /db writes for one company never reach another's post.
    assert.equal(await saveCollectedMetrics(owner.companyId, othersPost, { ...emptyMetricValues(), views: 5 }), false);
    assert.equal(await recordMetricsFailure(owner.companyId, othersPost, "timeout", null), false);
    assert.deepEqual([await metricsState(othersPost), (await snapshotRows(othersPost)).length], [{ attemptedAt: null, error: null }, 0]);
  });

  await check("metrics collection: an account needing a reconnect is skipped with its reason (reauthorization_needed, nothing asked); a platform's refusal or silence records its code on the post and makes no snapshot; X refusing the token marks the account as needing a reconnect, in the activity log too", async () => {
    const owner = await readyOwner("metrics-fail");
    const account = await xAccount(owner);
    const jobId = await realPost(owner, "x", account, "1790000000000000301");
    const setStatus = (status: "connected" | "needs_reauth") =>
      db.update(socialConnections).set({ status, lastError: status === "needs_reauth" ? "refresh_refused" : null }).where(eq(socialConnections.id, account));
    await setStatus("needs_reauth");
    const skipped = await captureConsole(() => collectFor([owner.companyId], noPlatform));
    assert.deepEqual([skipped.result, skipped.logs], [{ ...NOTHING, skipped: 1 }, ["Post metrics skipped: x reauthorization_needed"]]);
    assert.equal((await metricsState(jobId)).error, "reauthorization_needed");
    await setStatus("connected");
    for (const [answer, code] of [[new Response(null, { status: 503 }), "server_error"], [new Response(null, { status: 429 }), "rate_limited"]] as const) {
      await lastTriedAgo(jobId, 21);
      const failed = await captureConsole(() => collectFor([owner.companyId], fakePlatform([answer]).fetchFn));
      assert.deepEqual([failed.result, failed.logs], [{ ...NOTHING, failed: 1 }, [`Post metrics not collected: x ${code}`]]);
      assert.equal((await metricsState(jobId)).error, code);
    }
    assert.deepEqual(await snapshotRows(jobId), [], "a failure made a snapshot");
    await lastTriedAgo(jobId, 21);
    await captureConsole(() => collectFor([owner.companyId], fakePlatform([json({ title: "Unauthorized" }, 401)]).fetchFn));
    assert.equal((await metricsState(jobId)).error, "token_rejected");
    const [connection] = await db.select().from(socialConnections).where(eq(socialConnections.id, account));
    assert.deepEqual([connection.status, connection.lastError], ["needs_reauth", "token_rejected"]);
    const logged = await db
      .select({ code: cofounderActivity.code })
      .from(cofounderActivity)
      .where(and(eq(cofounderActivity.companyId, owner.companyId), eq(cofounderActivity.connectionId, account), eq(cofounderActivity.action, "reconnect_needed")));
    assert.deepEqual(logged, [{ code: "token_rejected" }]);
    // A success later clears the post's last failure.
    await setStatus("connected");
    await lastTriedAgo(jobId, 21);
    await collectFor([owner.companyId], fakePlatform([xNumbers({ impressions: 10, likes: 1, replies: 0, reposts: 0, quotes: 0 })]).fetchFn);
    assert.deepEqual([(await metricsState(jobId)).error, (await snapshotRows(jobId)).length], [null, 1]);
  });

  await check("metrics collection: two runs at the same moment read a post once (one request, one snapshot): each claims it in one UPDATE first", async () => {
    const owner = await readyOwner("metrics-race");
    const jobId = await realPost(owner, "x", await xAccount(owner), "1790000000000000401");
    let requests = 0;
    const slowX = async () => {
      requests += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return xNumbers({ impressions: 50, likes: 2, replies: 0, reposts: 0, quotes: 0 });
    };
    const runs = await Promise.all([collectFor([owner.companyId], slowX), collectFor([owner.companyId], slowX), collectFor([owner.companyId], slowX)]);
    assert.equal(runs.reduce((sum, run) => sum + run.collected, 0), 1);
    assert.deepEqual([requests, (await snapshotRows(jobId)).length], [1, 1]);
  });

  await check("metrics collection: a post is started only while its longest read (the account made ready, the platform's answer, the database) fits in the 300 seconds, at most a batch a run, and a run stopping with posts left says so in one fixed line", async () => {
    assert.ok(LONGEST_METRICS_RUN_MS >= LONGEST_PREPARATION_MS + API_TIMEOUT_MS && LONGEST_METRICS_RUN_MS < METRICS_RUN_BUDGET_MS, `${LONGEST_METRICS_RUN_MS} ms`);
    const owner = await readyOwner("metrics-budget");
    const account = await xAccount(owner);
    const first = await realPost(owner, "x", account, "1790000000000000501");
    const second = await realPost(owner, "x", account, "1790000000000000502");
    const startedWithTimeLeft = (leftMs: number) => Date.now() - (METRICS_RUN_BUDGET_MS - leftMs);
    const late = await captureConsole(() => collectFor([owner.companyId], noPlatform, { startedAt: startedWithTimeLeft(LONGEST_METRICS_RUN_MS - 1_000) }));
    assert.deepEqual([late.result, late.logs], [NOTHING, ["Post metrics run stopped at its time limit: posts are left for the next run"]]);
    const x = fakePlatform([xNumbers({ impressions: 1, likes: 1, replies: 0, reposts: 0, quotes: 0 })]);
    const oneOnly = await captureConsole(() => collectFor([owner.companyId], x.fetchFn, { batchSize: 1 }));
    assert.deepEqual([oneOnly.result, oneOnly.logs], [{ ...NOTHING, collected: 1 }, ["Post metrics run stopped at its batch size: posts are left for the next run"]]);
    // The one waiting longest went first: neither had a try, so the one out first.
    assert.deepEqual([(await snapshotRows(first)).length, (await snapshotRows(second)).length], [1, 0]);
    const rest = await captureConsole(() => collectFor([owner.companyId], fakePlatform([xNumbers({ impressions: 2, likes: 0, replies: 0, reposts: 0, quotes: 0 })]).fetchFn));
    assert.deepEqual([rest.result, rest.logs], [{ ...NOTHING, collected: 1 }, []]);
  });

  await check("publish route: after its due posts it reads a few posts' numbers (10 a call; the daily job 100, after its other work), on the same clock, and says what came of both", async () => {
    const secret = `metrics-route-${runId}`.padEnd(40, "m");
    const seen: { order: string[]; startedAt: number[] } = { order: [], startedAt: [] };
    const run = async (jobStartedAt: number) => {
      seen.order.push("publish");
      seen.startedAt.push(jobStartedAt);
      return { interrupted: 0, published: 1, failed: 0, needsAttention: 0, requeued: 0 };
    };
    const metrics = async (jobStartedAt: number) => {
      seen.order.push("metrics");
      seen.startedAt.push(jobStartedAt);
      return { ...NOTHING, collected: 2 };
    };
    const headers = { authorization: `Bearer ${secret}`, "x-forwarded-for": `metrics-route-${runId}` };
    const answer = await handlePublishCronRequest(new Request("http://localhost/api/cron/publish", { headers }), secret, run, metrics);
    assert.equal(answer.status, 200);
    assert.deepEqual(await answer.json(), { interrupted: 0, published: 1, failed: 0, needsAttention: 0, requeued: 0, metrics: { ...NOTHING, collected: 2 } });
    assert.deepEqual(seen.order, ["publish", "metrics"]);
    assert.equal(seen.startedAt[0], seen.startedAt[1], "the numbers didn't get the posts' clock");
    assert.deepEqual([PINGED_METRICS_BATCH, DAILY_METRICS_BATCH], [10, 100]);
    const cron = withoutComments(await read("services/publish-cron.ts"));
    assert.match(cron, /collectMetrics: \(jobStartedAt: number\) => Promise<MetricsRunCounts> = \(startedAt\) => collectPostMetrics\(startedAt, \{ batchSize: PINGED_METRICS_BATCH \}\)/);
    const daily = withoutComments(await read("services/maintenance.ts"));
    assert.match(daily, /collectMetrics: \(jobStartedAt: number\) => Promise<MetricsRunCounts> = collectPostMetrics,/);
  });
}
