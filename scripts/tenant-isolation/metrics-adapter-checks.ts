// Post number checks (step 42), the adapters: each platform is asked the
// request its documentation shows (docs/research/social-publishing-apis.md,
// section 5) and its answer read from the fields the research names: X's
// public_metrics and non_public_metrics, Facebook's shares and reaction and
// comment totals, YouTube's statistics; LinkedIn is never asked (its post
// numbers need a permission ansa's app can't get). A number a platform
// leaves out stays null, never 0. Fake platforms only.

import assert from "node:assert/strict";
import { appSecretProof } from "@/adapters/facebook-graph";
import { collectedColumns, METRIC_VALUE_MAX, metricColumns, type PostMetricValues } from "@/lib/metric-definitions";
import type { PlatformMode } from "@/lib/social-mode";
import type { SocialPlatform } from "@/lib/social-platforms";
import { fetchPostMetrics } from "@/lib/social-publishing";
import type { MetricsResult } from "@/lib/social-types";
import { xNumbers } from "./analytics-helpers";
import { check } from "./helpers";
import { fakeCredentials, fakePlatform, json, noPlatform } from "./social-helpers";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-28T12:00:00.000Z");

function realMode(platform: SocialPlatform): PlatformMode {
  return { kind: "real", credentials: fakeCredentials(platform) };
}

// Asks one platform for one post's numbers, as the collector does.
async function numbersOf(platform: SocialPlatform, externalPostId: string, answers: (Response | (() => Promise<Response>))[], daysOld = 1) {
  const fake = fakePlatform(answers);
  const target = { externalAccountId: "account-1", accessToken: `token-${platform}` };
  const request = { externalPostId, publishedAt: new Date(NOW.getTime() - daysOld * DAY_MS) };
  const result = await fetchPostMetrics({ platform, isStandIn: false }, target, request, realMode(platform), { fetchFn: fake.fetchFn, now: NOW });
  return { result, requests: fake.requests };
}

function values(result: MetricsResult): PostMetricValues {
  assert.equal(result.kind, "collected", JSON.stringify(result));
  return result.kind === "collected" ? result.values : ({} as PostMetricValues);
}

function filledColumns(numbers: PostMetricValues): string[] {
  return metricColumns.filter((column) => numbers[column] !== null);
}

export async function runMetricsAdapterChecks() {
  await check("x numbers: GET /2/tweets/<id> with tweet.fields public_metrics and non_public_metrics while the post is under 29 days old (public_metrics alone after), the account's token, a time limit, no redirect; impressions, likes, replies, reposts + quotes and link clicks; a 0 stays 0, a field X leaves out is null", async () => {
    const young = await numbersOf("x", "1790000000000000001", [xNumbers({ impressions: 120, likes: 8, replies: 0, reposts: 2, quotes: 1, bookmarks: 4, linkClicks: 5 })]);
    assert.equal(young.requests[0].url, "https://api.x.com/2/tweets/1790000000000000001?tweet.fields=public_metrics,non_public_metrics");
    assert.deepEqual([young.requests[0].method, young.requests[0].headers.authorization, young.requests[0].hadTimeLimit], ["GET", "Bearer token-x", true]);
    assert.deepEqual(values(young.result), { views: 120, reach: null, reactions: 8, comments: 0, shares: 3, clicks: 5, video_views: null });
    assert.deepEqual(filledColumns(values(young.result)), collectedColumns("x"));
    const old = await numbersOf("x", "1790000000000000002", [xNumbers({ impressions: 900, likes: 30, replies: 4, reposts: 6 })], 29.5);
    assert.equal(old.requests[0].url, "https://api.x.com/2/tweets/1790000000000000002?tweet.fields=public_metrics");
    // No quote count: reposts alone would be a wrong total, so shares stay unknown.
    assert.deepEqual(values(old.result), { views: 900, reach: null, reactions: 30, comments: 4, shares: null, clicks: null, video_views: null });
  });

  await check("x numbers: 401 is token_rejected, 403 permission_denied, 404 not_found, 429 rate_limited, 503 server_error, no answer a timeout or network error; a 200 holding only X's resource-not-found problem is not_found too, any other 200 without a post holds no numbers, a negative or non-whole count makes the answer unreadable, and an odd id asks nothing", async () => {
    const codes: [number, string][] = [[401, "token_rejected"], [403, "permission_denied"], [404, "not_found"], [429, "rate_limited"], [503, "server_error"], [400, "invalid_request"]];
    for (const [status, code] of codes) {
      assert.deepEqual((await numbersOf("x", "1790000000000000003", [new Response(null, { status })])).result, { kind: "failed", code }, String(status));
    }
    const unreachable = async () => Promise.reject(new TypeError("fetch failed"));
    assert.deepEqual((await numbersOf("x", "1790000000000000003", [unreachable])).result, { kind: "failed", code: "network_error" });
    // A post deleted on X: the problem type as api.x.com writes it, and as api.twitter.com did.
    const notFound = (host: string) => json({ errors: [{ title: "Not Found Error", detail: "Could not find tweet", type: `https://${host}/2/problems/resource-not-found` }] });
    for (const host of ["api.x.com", "api.twitter.com"]) {
      assert.deepEqual((await numbersOf("x", "1790000000000000003", [notFound(host)])).result, { kind: "failed", code: "not_found" }, host);
    }
    const hidden = json({ errors: [{ title: "Authorization Error", type: "https://api.x.com/2/problems/not-authorized-for-resource" }] });
    for (const answer of [hidden, json({}), json({ errors: [{ title: "Not Found Error" }] })]) {
      assert.deepEqual((await numbersOf("x", "1790000000000000003", [answer])).result, { kind: "failed", code: "no_numbers" });
    }
    for (const odd of [-1, 2.5, METRIC_VALUE_MAX + 1]) {
      assert.deepEqual((await numbersOf("x", "1790000000000000003", [xNumbers({ impressions: odd, likes: 1 })])).result, { kind: "failed", code: "unexpected_answer" }, String(odd));
    }
    const odd = await numbersOf("x", "../users/me", [xNumbers({ likes: 1 })]);
    assert.deepEqual([odd.result, odd.requests.length], [{ kind: "failed", code: "invalid_request" }, 0]);
  });

  await check("facebook numbers: one GET of the post with fields shares, reactions.limit(0).summary(total_count) and comments.limit(0).summary(true), the Page's token and its appsecret_proof; reactions and comments from their totals, shares from shares.count (left out: null, never 0); views, viewers and clicks are never asked (they need read_insights)", async () => {
    const answer = json({ id: "123_456", shares: { count: 4 }, reactions: { data: [], summary: { total_count: 12 } }, comments: { data: [], summary: { order: "ranked", total_count: 3 } } });
    const read = await numbersOf("facebook", "123_456", [answer]);
    const url = new URL(read.requests[0].url);
    assert.equal(`${url.origin}${url.pathname}`, "https://graph.facebook.com/v26.0/123_456");
    assert.equal(url.searchParams.get("fields"), "shares,reactions.limit(0).summary(total_count),comments.limit(0).summary(true)");
    assert.equal(url.searchParams.get("access_token"), "token-facebook");
    assert.equal(url.searchParams.get("appsecret_proof"), appSecretProof("token-facebook", fakeCredentials("facebook").clientSecret));
    assert.doesNotMatch(read.requests[0].url, /insights|post_media_view|post_clicks/);
    assert.deepEqual(values(read.result), { views: null, reach: null, reactions: 12, comments: 3, shares: 4, clicks: null, video_views: null });
    assert.deepEqual(filledColumns(values(read.result)), collectedColumns("facebook"));
    const unshared = await numbersOf("facebook", "123_457", [json({ id: "123_457", reactions: { summary: { total_count: 0 } }, comments: { summary: { total_count: 0 } } })]);
    assert.deepEqual(values(unshared.result), { views: null, reach: null, reactions: 0, comments: 0, shares: null, clicks: null, video_views: null });
    const graphError = (code: number, status = 400) => json({ error: { code, message: "Something about the token" } }, status);
    const codes: [Response, string][] = [[graphError(190), "token_rejected"], [graphError(4), "rate_limited"], [graphError(80001), "rate_limited"], [graphError(10, 403), "permission_denied"], [graphError(230, 403), "permission_denied"], [graphError(100), "invalid_request"], [graphError(2, 500), "server_error"]];
    for (const [response, code] of codes) {
      assert.deepEqual((await numbersOf("facebook", "123_458", [response])).result, { kind: "failed", code });
    }
    assert.deepEqual((await numbersOf("facebook", "123_459", [json({ id: "123_459" })])).result, { kind: "failed", code: "no_numbers" });
  });

  await check("youtube numbers: videos.list with part=statistics for the video's id and the channel's token; viewCount, likeCount and commentCount (strings of digits) as views, likes and comments; a count YouTube hides is null; an unknown video (404, or no items) is not_found; quotaExceeded is quota_exceeded; a count past Postgres's integer makes the answer unreadable", async () => {
    const read = await numbersOf("youtube", "dQw4w9WgXcQ", [json({ items: [{ id: "dQw4w9WgXcQ", statistics: { viewCount: "1500", likeCount: "40", favoriteCount: "0", commentCount: "7" } }] })]);
    assert.equal(read.requests[0].url, "https://www.googleapis.com/youtube/v3/videos?part=statistics&id=dQw4w9WgXcQ");
    assert.equal(read.requests[0].headers.authorization, "Bearer token-youtube");
    assert.deepEqual(values(read.result), { views: 1500, reach: null, reactions: 40, comments: 7, shares: null, clicks: null, video_views: null });
    assert.deepEqual(filledColumns(values(read.result)), collectedColumns("youtube"));
    const hidden = await numbersOf("youtube", "dQw4w9WgXcR", [json({ items: [{ id: "dQw4w9WgXcR", statistics: { viewCount: "12" } }] })]);
    assert.deepEqual(values(hidden.result), { views: 12, reach: null, reactions: null, comments: null, shares: null, clicks: null, video_views: null });
    const quota = json({ error: { errors: [{ reason: "quotaExceeded", message: "The request cannot be completed" }] } }, 403);
    const cases: [Response, string][] = [[json({ items: [] }), "not_found"], [new Response(null, { status: 404 }), "not_found"], [quota, "quota_exceeded"], [new Response(null, { status: 401 }), "token_rejected"], [json({ items: [{ statistics: { viewCount: "99999999999" } }] }), "unexpected_answer"]];
    for (const [response, code] of cases) {
      assert.deepEqual((await numbersOf("youtube", "dQw4w9WgXcS", [response])).result, { kind: "failed", code });
    }
  });

  await check("linkedin numbers: LinkedIn is never asked (its member post numbers need r_member_postAnalytics, a Community Management permission ansa's app can't ask for), so none is read; its definitions say so", async () => {
    const read = await numbersOf("linkedin", "urn:li:share:7000000000000000001", []);
    assert.deepEqual([read.result, read.requests.length], [{ kind: "unavailable", code: "needs_permission" }, 0]);
    assert.deepEqual(collectedColumns("linkedin"), []);
    const target = { externalAccountId: "m", accessToken: "t" };
    const request = { externalPostId: "urn:li:share:1", publishedAt: NOW };
    assert.deepEqual(await fetchPostMetrics({ platform: "linkedin", isStandIn: false }, target, request, realMode("linkedin"), { fetchFn: noPlatform, now: NOW }), { kind: "unavailable", code: "needs_permission" });
  });
}
