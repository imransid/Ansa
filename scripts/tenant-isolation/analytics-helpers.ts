// Shared pieces for the analytics checks (step 42): posts that went out the
// way the queue sends them (to a development stand-in, or to a "real"
// account answered by a fake platform), their numbers read by the collector
// with fake platforms or simulated as `pnpm simulate:post-metrics` does,
// and what the database holds. No real platform is ever asked.

import assert from "node:assert/strict";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { postMetrics, publishJobs } from "@/db/schema";
import type { SessionContext } from "@/lib/session";
import type { SocialPlatform } from "@/lib/social-platforms";
import type { SocialFetch } from "@/lib/social-types";
import { collectPostMetrics } from "@/services/post-metrics-collection";
import { simulatePostMetrics } from "@/services/post-metrics-simulation";
import { approveDraft, generatedDraftId, LINKEDIN_POST } from "./content-studio-helpers";
import { runId } from "./helpers";
import { jobRow, linkedInPosted, makeDue, runNow, schedule, scheduledJobIds, standInAccount, throughFakePlatform, trackStandInJob } from "./publishing-helpers";
import { connectFully, connectionRows, everyPlatformReal, facebookConnects, fakePlatform, json, ownXAccountId, xConnects } from "./social-helpers";

// What "New draft" sends for a text post on a platform.
export function textPostRequest(platform: SocialPlatform, topic: string, pillar = "") {
  return { ...LINKEDIN_POST, platform, topic, pillar };
}

// An approved text post of the company (made ready for drafts already): its id.
export async function approvedTextPost(owner: SessionContext, platform: SocialPlatform, topic: string, pillar = ""): Promise<string> {
  const draftId = await generatedDraftId(owner, textPostRequest(platform, topic, pillar));
  assert.deepEqual(await approveDraft(owner, draftId, true), { ok: true });
  return draftId;
}

// A text post that went out to the company's stand-in account of the
// platform, right after scheduling, as the queue sends it: its job's id.
export async function standInPost(owner: SessionContext, topic: string, options: { platform?: SocialPlatform; pillar?: string } = {}): Promise<string> {
  const platform = options.platform ?? "linkedin";
  const draftId = await approvedTextPost(owner, platform, topic, options.pillar ?? "");
  const account = await standInAccount(owner, platform);
  const { result, after } = await schedule(owner, draftId, [account]);
  assert.deepEqual(result, { ok: true });
  await after.settle();
  const [job] = await db.select().from(publishJobs).where(eq(publishJobs.draftId, draftId));
  assert.equal(job?.status, "published", "the stand-in didn't publish the post");
  await trackStandInJob(job.id);
  return job.id;
}

// The company's X account, connected through X's (fake) consent round: its id.
export async function xAccount(owner: SessionContext): Promise<string> {
  await connectFully(owner, "x", xConnects(ownXAccountId()));
  // Not the company's stand-in X account, if a check connected one first.
  const row = (await connectionRows(owner.companyId)).find((connection) => connection.platform === "x" && !connection.isStandIn);
  assert.ok(row, "no X account");
  return row.id;
}

// The company's Facebook Page, connected through Meta's (fake) round: its id.
export async function facebookPage(owner: SessionContext, pageId: string): Promise<string> {
  await connectFully(owner, "facebook", facebookConnects([{ id: pageId, name: "Bluebird Bakery", tasks: ["CREATE_CONTENT", "ANALYZE"] }]));
  const row = (await connectionRows(owner.companyId)).find((connection) => connection.externalAccountId === pageId);
  assert.ok(row, "no Facebook Page");
  return row.id;
}

// What each platform answers when it made the post, with its id.
const POSTED: Record<SocialPlatform, (postId: string) => Response> = {
  linkedin: linkedInPosted,
  facebook: (postId) => json({ id: postId }),
  x: (postId) => json({ data: { id: postId } }, 201),
  youtube: (postId) => json({ id: postId }),
};

// A text post that went out to a "real" account (a fake platform answering
// with postId), minutesAgo since: its job's id.
export async function realPost(owner: SessionContext, platform: SocialPlatform, accountId: string, postId: string, minutesAgo = 120): Promise<string> {
  const draftId = await approvedTextPost(owner, platform, `${platform} post ${postId} ${runId}`);
  const [jobId] = await scheduledJobIds(owner, draftId, [accountId]);
  await makeDue(jobId);
  assert.equal(await runNow(owner, jobId, throughFakePlatform(fakePlatform([POSTED[platform](postId)]).fetchFn)), "published");
  await wentOutAgo(jobId, minutesAgo);
  return jobId;
}

// Moves a published post's time back, as if it went out minutes ago.
export async function wentOutAgo(jobId: string, minutes: number): Promise<void> {
  await db.update(publishJobs).set({ publishedAt: sql`now() - make_interval(mins => ${minutes})` }).where(eq(publishJobs.id, jobId));
}

// Moves a post's last try at its numbers back, as if it was hours ago.
export async function lastTriedAgo(jobId: string, hours: number): Promise<void> {
  await db.update(publishJobs).set({ metricsAttemptedAt: sql`now() - make_interval(hours => ${hours})` }).where(eq(publishJobs.id, jobId));
}

// Simulated numbers for a stand-in's post, as the command saves them; must work.
export async function simulated(jobId: string, args: string[]): Promise<void> {
  const result = await simulatePostMetrics(jobId, args);
  assert.ok(result.ok, result.ok ? "" : result.message);
}

// One company's run of the collector, the platforms answered by fetchFn.
export async function collectFor(companyIds: string[], fetchFn: SocialFetch, extra: { batchSize?: number; startedAt?: number } = {}) {
  return collectPostMetrics(extra.startedAt ?? Date.now(), { onlyCompanyIds: companyIds, batchSize: extra.batchSize, social: { modeOf: everyPlatformReal, fetchFn } });
}

// X's answer for one post's numbers, with the fields the research names.
export function xNumbers(numbers: { impressions?: number; likes?: number; replies?: number; reposts?: number; quotes?: number; bookmarks?: number; linkClicks?: number }) {
  const publicMetrics = {
    impression_count: numbers.impressions,
    like_count: numbers.likes,
    reply_count: numbers.replies,
    retweet_count: numbers.reposts,
    quote_count: numbers.quotes,
    bookmark_count: numbers.bookmarks,
  };
  const nonPublic = numbers.linkClicks === undefined ? {} : { non_public_metrics: { impression_count: numbers.impressions, url_link_clicks: numbers.linkClicks, user_profile_clicks: 1, engagements: 3 } };
  return json({ data: { id: "1790000000000000001", text: "Fresh sourdough", public_metrics: publicMetrics, ...nonPublic } });
}

// One job's snapshots, oldest first.
export async function snapshotRows(jobId: string) {
  return db.select().from(postMetrics).where(eq(postMetrics.publishJobId, jobId)).orderBy(asc(postMetrics.collectedAt), asc(postMetrics.createdAt));
}

// The job's metrics columns as stored.
export async function metricsState(jobId: string) {
  const job = await jobRow(jobId);
  return { attemptedAt: job.metricsAttemptedAt, error: job.metricsError };
}
