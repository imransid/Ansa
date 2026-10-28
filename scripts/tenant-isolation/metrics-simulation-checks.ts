// Post number checks (step 42), `pnpm simulate:post-metrics`: numbers for a
// development stand-in's post only, labeled as simulated; never for a real
// account's post, a post that didn't go out, a number the platform doesn't
// have, odd input, or production; the command itself refuses to run
// outside a local database.

import assert from "node:assert/strict";
import { readMetricArguments, simulatePostMetrics } from "@/services/post-metrics-simulation";
import { getAnalyticsPageForSession } from "@/services/analytics-page";
import { approvedTextPost, realPost, snapshotRows, standInPost, xAccount } from "./analytics-helpers";
import { makeReadyForDrafts } from "./content-studio-helpers";
import { check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { scheduledJobIds, standInAccount } from "./publishing-helpers";
import { read } from "./source-helpers";

// A refusal's message ("" when it saved).
function messageOfSimulation(result: Awaited<ReturnType<typeof simulatePostMetrics>>): string {
  return result.ok ? "" : result.message;
}

export async function runMetricsSimulationChecks() {
  await check("simulate:post-metrics: saves a dev_simulated snapshot of a stand-in's published post (the numbers given, the rest null), which the Analytics page shows as simulated; a real account's post is refused (its numbers come from its platform only), and so is one that didn't go out", async () => {
    const owner = sessionFor(await signUpTestOwner("metrics-sim"));
    await makeReadyForDrafts(owner);
    const jobId = await standInPost(owner, `Simulated ${runId}`);
    const saved = await simulatePostMetrics(jobId.toUpperCase(), ["views=120", "reactions=8", "shares=0"]);
    assert.deepEqual(saved, { ok: true, companyId: owner.companyId, platform: "linkedin", values: { views: 120, reactions: 8, shares: 0 } });
    const [snapshot] = await snapshotRows(jobId);
    assert.deepEqual([snapshot.source, snapshot.views, snapshot.reach, snapshot.reactions, snapshot.comments, snapshot.shares, snapshot.clicks], ["dev_simulated", 120, null, 8, null, 0, null]);
    const page = await getAnalyticsPageForSession(owner, {});
    const shown = page.posts.find((post) => post.jobId === jobId);
    assert.deepEqual([shown?.latest?.source, shown?.latest?.values.views, page.totals[0]?.simulated], ["dev_simulated", 120, true]);
    const account = await xAccount(owner);
    const real = await realPost(owner, "x", account, "1790000000000000601");
    assert.deepEqual(await simulatePostMetrics(real, ["views=5"]), { ok: false, message: "That post went to a real account: its numbers come from its platform only, never from a simulation." });
    const waitingDraft = await approvedTextPost(owner, "linkedin", `Waiting ${runId}`);
    const [waiting] = await scheduledJobIds(owner, waitingDraft, [await standInAccount(owner)]);
    assert.deepEqual(await simulatePostMetrics(waiting, ["views=5"]), { ok: false, message: "That post hasn't gone out, so it has no numbers yet." });
    assert.deepEqual([(await snapshotRows(real)).length, (await snapshotRows(waiting)).length], [0, 0]);
  });

  await check("simulate:post-metrics: refuses a number the post's platform doesn't have (X's reach, LinkedIn's video views), an unknown or repeated number, a negative, decimal or too large one, no number, an id that isn't one or no post's, and production; nothing is saved", async () => {
    const owner = sessionFor(await signUpTestOwner("metrics-sim-refuse"));
    await makeReadyForDrafts(owner);
    const xPost = await standInPost(owner, `X simulated ${runId}`, { platform: "x" });
    assert.deepEqual(await simulatePostMetrics(xPost, ["views=10", "reach=4"]), { ok: false, message: "X gives no reach: leave it out." });
    const linkedInPost = await standInPost(owner, `LinkedIn simulated ${runId}`);
    assert.deepEqual(await simulatePostMetrics(linkedInPost, ["video_views=4"]), { ok: false, message: "LinkedIn gives no video views: leave it out." });
    const refusals: [string[], RegExp][] = [
      [["likes=3"], /"likes=3" isn't a number ansa keeps/],
      [["views=1", "views=2"], /views is given twice/],
      [["views=-1"], /"views=-1" isn't a number ansa keeps|whole number/],
      [["views=1.5"], /whole number/],
      [["views=99999999999"], /whole number from 0 to 2147483647/],
      [["views="], /whole number/],
      [[], /Give at least one number/],
    ];
    for (const [args, message] of refusals) {
      const result = readMetricArguments(args);
      assert.match(result.ok ? "" : result.message, message, args.join(" "));
    }
    assert.match(messageOfSimulation(await simulatePostMetrics("not-an-id", ["views=1"])), /isn't a publish job id/);
    assert.deepEqual(await simulatePostMetrics("00000000-0000-4000-8000-000000000000", ["views=1"]), { ok: false, message: "No post has that id." });
    assert.match(messageOfSimulation(await simulatePostMetrics(xPost, ["views=1"], "production")), /development only/);
    assert.deepEqual([(await snapshotRows(xPost)).length, (await snapshotRows(linkedInPost)).length], [0, 0]);
  });

  await check("simulate:post-metrics: the command refuses to run outside a local database or with an outside service on (the checks' own guard), takes the job id and name=value numbers, and is a package script", async () => {
    const script = await read("scripts/simulate-post-metrics.ts");
    assert.match(script, /const reasonNotToRun = findReasonNotToRunChecks\(process\.env\);\s*if \(reasonNotToRun\) \{[\s\S]*?process\.exitCode = 1;\s*return;/);
    assert.ok(script.indexOf("findReasonNotToRunChecks(process.env)") < script.indexOf("simulatePostMetrics(jobId"), "the guard doesn't come first");
    const packageJson = JSON.parse(await read("package.json"));
    assert.equal(packageJson.scripts["simulate:post-metrics"], "tsx --conditions=react-server --env-file=.env.local scripts/simulate-post-metrics.ts");
  });
}
