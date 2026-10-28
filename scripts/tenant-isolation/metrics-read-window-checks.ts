// Post number checks (step 42), how long a post's numbers are read: for 30
// days after it went out, X's for 28 (X gives link clicks for a post's
// first 30 days, asked for under 29, and a read without them would hide
// the ones read before: the page and the review show each post's newest
// snapshot). Past that, the Analytics page promises no more: neither "Not
// read yet" nor "ansa tries again tomorrow". Fake platforms only.

import assert from "node:assert/strict";
import { recordMetricsFailure, saveCollectedMetrics } from "@/db/post-metrics";
import { describeLatestTryProblem, describeWhyNoNumbers } from "@/lib/analytics/post-notes";
import { areNumbersStillRead, emptyMetricValues } from "@/lib/metric-definitions";
import { getAnalyticsPageForSession } from "@/services/analytics-page";
import { collectFor, facebookPage, lastTriedAgo, realPost, snapshotRows, wentOutAgo, xAccount, xNumbers } from "./analytics-helpers";
import { makeReadyForDrafts } from "./content-studio-helpers";
import { check, sessionFor, signUpTestOwner } from "./helpers";
import { fakePlatform, json } from "./social-helpers";
import { read, withoutComments } from "./source-helpers";

const DAY_MINUTES = 24 * 60;
const NOTHING = { collected: 0, failed: 0, skipped: 0 };

export async function runMetricsReadWindowChecks() {
  await check("metrics collection: an X post is read for 28 days only, so its newest snapshot keeps the link clicks X gives under 29 days (a read after would have none and hide them on the page and in reviews); a Facebook post as old is still read (30 days)", async () => {
    const owner = sessionFor(await signUpTestOwner("metrics-x-days"));
    await makeReadyForDrafts(owner);
    const account = await xAccount(owner);
    const xPost = await realPost(owner, "x", account, "1790000000000000701", 27.5 * DAY_MINUTES);
    const firstRead = fakePlatform([xNumbers({ impressions: 900, likes: 30, replies: 4, reposts: 6, quotes: 1, linkClicks: 12 })]);
    assert.deepEqual(await collectFor([owner.companyId], firstRead.fetchFn), { ...NOTHING, collected: 1 });
    assert.match(firstRead.requests[0].url, /tweet\.fields=public_metrics,non_public_metrics$/);

    // Two days on, past X's 28 days (and its 29 for link clicks); a Facebook post as old.
    await wentOutAgo(xPost, 29.5 * DAY_MINUTES);
    await lastTriedAgo(xPost, 21);
    const facebookPost = await realPost(owner, "facebook", await facebookPage(owner, "1234567890"), "1234567890_701", 29.5 * DAY_MINUTES);
    // Never read, and past X's 28 days by half a day: not read now either.
    const unreadXPost = await realPost(owner, "x", account, "1790000000000000702", 28.5 * DAY_MINUTES);
    const facebookNumbers = json({ id: "1234567890_701", shares: { count: 2 }, reactions: { summary: { total_count: 9 } }, comments: { summary: { total_count: 1 } } });
    const later = fakePlatform([facebookNumbers, xNumbers({ impressions: 950, likes: 31, replies: 4, reposts: 6, quotes: 1 })]);
    assert.deepEqual(await collectFor([owner.companyId], later.fetchFn), { ...NOTHING, collected: 1 });
    assert.deepEqual(later.requests.map((request) => new URL(request.url).host), ["graph.facebook.com"]);
    assert.deepEqual((await snapshotRows(facebookPost)).map((row) => row.reactions), [9]);
    assert.deepEqual((await snapshotRows(xPost)).map((row) => row.clicks), [12]);
    assert.deepEqual(await snapshotRows(unreadXPost), []);
    const page = await getAnalyticsPageForSession(owner, { period: "90" });
    assert.equal(page.posts.find((post) => post.jobId === xPost)?.latest?.values.clicks, 12);
  });

  await check("analytics page: a post past its platform's read days without numbers says none were read in those days, never 'Not read yet' (which a newer one still says); under older numbers, its failed last try no longer promises another; the table says what these words say", async () => {
    const owner = sessionFor(await signUpTestOwner("metrics-past-days"));
    await makeReadyForDrafts(owner);
    const account = await xAccount(owner);
    const neverRead = await realPost(owner, "x", account, "1790000000000000711", 45 * DAY_MINUTES);
    const fresh = await realPost(owner, "x", account, "1790000000000000712", 120);
    const failedLate = await realPost(owner, "x", account, "1790000000000000713", 29 * DAY_MINUTES);
    const failedRecently = await realPost(owner, "x", account, "1790000000000000714", 3 * DAY_MINUTES);
    for (const jobId of [failedLate, failedRecently]) {
      assert.equal(await saveCollectedMetrics(owner.companyId, jobId, { ...emptyMetricValues(), views: 40 }), true);
      assert.equal(await recordMetricsFailure(owner.companyId, jobId, "timeout", null), true);
    }
    const page = await getAnalyticsPageForSession(owner, { period: "90" });
    const shown = (jobId: string) => {
      const post = page.posts.find((candidate) => candidate.jobId === jobId);
      assert.ok(post, "the post isn't listed");
      return post;
    };
    assert.deepEqual([shown(neverRead).numbersStillRead, shown(fresh).numbersStillRead, shown(failedLate).numbersStillRead], [false, true, false]);
    assert.equal(describeWhyNoNumbers(shown(neverRead), "X"), "ansa reads X posts' numbers for 28 days after they go out, and read none for this one.");
    assert.equal(describeWhyNoNumbers(shown(fresh), "X"), "Not read yet: ansa reads a post's numbers about once a day, from an hour after it went out.");
    assert.equal(describeLatestTryProblem(shown(failedLate), "X"), null);
    assert.equal(describeLatestTryProblem(shown(failedRecently), "X"), "X didn't answer properly when ansa asked. ansa tries again tomorrow.");
    // As old as that X post, a Facebook post is still read.
    assert.equal(areNumbersStillRead("facebook", shown(failedLate).publishedAt, new Date()), true);
    const table = withoutComments(await read("app/cofounder/analytics/post-table.tsx"));
    assert.match(table, /describeLatestTryProblem\(post, platformLabel\)/);
    assert.match(table, /describeWhyNoNumbers\(post, platformLabel\)/);
  });
}
