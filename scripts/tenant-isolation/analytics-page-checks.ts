// Analytics page checks (step 42): in the Co-Founder's row of links after
// Queue, bringing logged-out people back to itself, allowed 300 seconds
// (the review asks Claude); its data is the company's own: the period's
// posts with their newest numbers, totals that add only the numbers posts
// have ("not available" where a platform has no such number, never 0),
// the period's publishing problems, the last collection; another
// company's posts, numbers and reviews never show. Through the real
// services and /db; fake platforms only.

import assert from "node:assert/strict";
import { COFOUNDER_PAGES } from "@/lib/cofounder/pages";
import { getAnalyticsPageForSession } from "@/services/analytics-page";
import { approvedTextPost, simulated, standInPost, wentOutAgo, xAccount } from "./analytics-helpers";
import { makeReadyForDrafts } from "./content-studio-helpers";
import { addTeammate, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { makeDue, runNow, scheduledJobIds, throughFakePlatform } from "./publishing-helpers";
import { fakePlatform } from "./social-helpers";
import { read, withoutComments } from "./source-helpers";

export async function runAnalyticsPageChecks() {
  await check("analytics page: in the Co-Founder's row of links after Queue, with its h1, bringing logged-out people back to itself, allowed 300 seconds (the review asks Claude in its action); the review form sends from onSubmit with the browser's timezone; its problems list has no buttons", async () => {
    const segments = COFOUNDER_PAGES.map((page) => page.segment);
    assert.equal(segments[segments.indexOf("queue") + 1], "analytics");
    const page = withoutComments(await read("app/cofounder/analytics/page.tsx"));
    assert.match(page, /requireSessionContext\("\/cofounder\/analytics"\)/);
    assert.match(page, /<h1/);
    assert.match(await read("app/cofounder/analytics/page.tsx"), /^export const maxDuration = 300;$/m);
    assert.match(page, /<JobList jobs=\{page\.problems\} canManage=\{false\} showDraft \/>/);
    const form = withoutComments(await read("app/cofounder/analytics/review-form.tsx"));
    assert.match(form, /onSubmit=\{submit\}/);
    assert.match(form, /event\.preventDefault\(\)[\s\S]*?formData\.set\("timeZone", Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone[\s\S]*?startTransition\(/);
  });

  await check("analytics page: the period's posts newest first, each with its newest snapshot; totals per platform add only the numbers posts have (a post without one adds nothing, not 0), say 'not available' where the platform has no such number and why where ansa doesn't read it; ?period= is 7, 30 or 90, anything else 30", async () => {
    const owner = sessionFor(await signUpTestOwner("analytics-page"));
    await makeReadyForDrafts(owner);
    const linkedIn = await standInPost(owner, `LinkedIn numbers ${runId}`);
    await simulated(linkedIn, ["views=100", "reactions=5"]);
    await simulated(linkedIn, ["views=150", "reactions=6"]);
    const xPost = await standInPost(owner, `X numbers ${runId}`, { platform: "x" });
    await simulated(xPost, ["views=40", "reactions=2"]);
    const older = await standInPost(owner, `Ten days ago ${runId}`);
    await simulated(older, ["views=60", "comments=1"]);
    await wentOutAgo(older, 10 * 24 * 60);
    const noNumbers = await standInPost(owner, `No numbers ${runId}`);

    const week = await getAnalyticsPageForSession(owner, { period: "7" });
    assert.equal(week.period, "7");
    assert.deepEqual(week.posts.map((post) => post.jobId), [noNumbers, xPost, linkedIn]);
    assert.deepEqual([week.postCount, week.postsWithNumbers, week.postsNeededForReview], [3, 2, 3]);
    assert.deepEqual(week.posts.find((post) => post.jobId === linkedIn)?.latest?.values.views, 150);
    const [linkedInTotals, xTotals] = week.totals;
    assert.deepEqual([linkedInTotals.platform, linkedInTotals.posts, linkedInTotals.postsWithNumbers, linkedInTotals.simulated], ["linkedin", 2, 1, true]);
    assert.deepEqual(linkedInTotals.metrics.views, { kind: "total", value: 150, posts: 1 });
    assert.equal(linkedInTotals.metrics.comments.kind, "not_collected");
    assert.deepEqual(linkedInTotals.metrics.video_views, { kind: "not_offered" });
    assert.deepEqual(xTotals.metrics.views, { kind: "total", value: 40, posts: 1 });
    assert.deepEqual(xTotals.metrics.reach, { kind: "not_offered" });
    assert.deepEqual(xTotals.metrics.shares, { kind: "no_numbers_yet" });

    const month = await getAnalyticsPageForSession(owner, { period: "30" });
    assert.deepEqual(month.posts.map((post) => post.jobId), [noNumbers, xPost, linkedIn, older]);
    assert.deepEqual(month.totals[0].metrics.views, { kind: "total", value: 210, posts: 2 });
    assert.deepEqual(month.totals[0].metrics.comments, { kind: "total", value: 1, posts: 1 });
    for (const odd of ["365", "", ["7", "90"], undefined]) {
      assert.equal((await getAnalyticsPageForSession(owner, { period: odd })).period, "30", String(odd));
    }
    assert.ok((await getAnalyticsPageForSession(owner, { period: "90" })).periodStart.getTime() < month.periodStart.getTime());
  });

  await check("analytics page: another company's posts, numbers, problems and reviews never show; the period's publishing problems do, the last simulated collection is named, and a member reads it all without the review button", async () => {
    const ownerUser = await signUpTestOwner("analytics-own");
    const owner = sessionFor(ownerUser);
    const other = sessionFor(await signUpTestOwner("analytics-other"));
    await makeReadyForDrafts(owner);
    await makeReadyForDrafts(other);
    const mine = await standInPost(owner, `Mine ${runId}`);
    await simulated(mine, ["views=7"]);
    const theirs = await standInPost(other, `Theirs ${runId}`);
    await simulated(theirs, ["views=900"]);
    const otherAccount = await xAccount(other);
    const otherDraft = await approvedTextPost(other, "x", `Their failure ${runId}`);
    const [otherFailed] = await scheduledJobIds(other, otherDraft, [otherAccount]);
    await makeDue(otherFailed);
    assert.equal(await runNow(other, otherFailed, throughFakePlatform(fakePlatform([new Response(null, { status: 400 })]).fetchFn)), "failed");
    const myAccount = await xAccount(owner);
    const myDraft = await approvedTextPost(owner, "x", `My failure ${runId}`);
    const [myFailed] = await scheduledJobIds(owner, myDraft, [myAccount]);
    await makeDue(myFailed);
    assert.equal(await runNow(owner, myFailed, throughFakePlatform(fakePlatform([new Response(null, { status: 400 })]).fetchFn)), "failed");

    const page = await getAnalyticsPageForSession(owner, {});
    assert.deepEqual(page.posts.map((post) => post.jobId), [mine]);
    assert.deepEqual(page.totals.map((totals) => [totals.platform, totals.metrics.views]), [["linkedin", { kind: "total", value: 7, posts: 1 }]]);
    assert.deepEqual(page.problems.map((job) => [job.id, job.status, job.lastError]), [[myFailed, "failed", "invalid_request"]]);
    assert.ok(page.activity.lastSimulatedAt && page.activity.lastCollectedAt === null);
    assert.equal(page.review, null);
    assert.equal(page.canReview, true);
    const member = sessionFor(await addTeammate(ownerUser, "analytics-member", "member"));
    const asMember = await getAnalyticsPageForSession(member, {});
    assert.deepEqual([asMember.posts.map((post) => post.jobId), asMember.canReview], [[mine], false]);
  });
}
