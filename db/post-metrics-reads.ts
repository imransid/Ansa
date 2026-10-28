import "server-only";
import { and, desc, eq, gte, isNotNull, lt, max, sql, type SQL } from "drizzle-orm";
import type { PostMetricSource } from "@/lib/analytics/kinds";
import type { ContentFormat } from "@/lib/content-studio/formats";
import type { PostMetricValues } from "@/lib/metric-definitions";
import type { SocialPlatform } from "@/lib/social-platforms";
import { db } from "./client";
import { contentDrafts, postMetrics, publishJobs, socialConnections } from "./schema";

// Reading one company's published posts with their numbers (step 42), for
// the Analytics page and the performance review: each post that went out in
// a period, with its latest snapshot. The company first in every WHERE, and
// every join matches company_id too, so nothing of another company shows.

export type LatestMetrics = { collectedAt: Date; source: PostMetricSource; values: PostMetricValues };

export type PublishedPost = {
  jobId: string;
  draftId: string;
  topic: string;
  platform: SocialPlatform;
  format: ContentFormat;
  // The marketing plan's content pillar the draft belongs to ("" = none).
  pillar: string;
  accountName: string | null;
  accountIsStandIn: boolean;
  publishedAt: Date;
  // The platform's id of the post: none for a post an owner marked as published.
  hasPlatformId: boolean;
  metricsAttemptedAt: Date | null;
  metricsError: string | null;
  // null: no snapshot yet.
  latest: LatestMetrics | null;
};

export type MetricsActivity = { lastAttemptAt: Date | null; lastCollectedAt: Date | null; lastSimulatedAt: Date | null };

// One company's posts that went out from `from` to `to`, newest first.
export async function getPublishedPostsBetween(companyId: string, from: Date, to: Date, limit: number): Promise<PublishedPost[]> {
  return listPublishedPosts(companyId, from, to, limit, false);
}

// The same, only those with numbers (what a performance review reads).
export async function getPostsWithNumbersBetween(companyId: string, from: Date, to: Date, limit: number): Promise<PublishedPost[]> {
  return listPublishedPosts(companyId, from, to, limit, true);
}

// How many of one company's posts went out in the period, and how many of them have numbers.
export async function countPublishedPostsBetween(companyId: string, from: Date, to: Date): Promise<{ posts: number; withNumbers: number }> {
  const hasSnapshot = sql`exists (select 1 from ${postMetrics} where ${postMetrics.companyId} = ${companyId} and ${postMetrics.publishJobId} = ${publishJobs.id})`;
  const [counted] = await db
    .select({ posts: sql<number>`count(*)`.mapWith(Number), withNumbers: sql<number>`count(*) filter (where ${hasSnapshot})`.mapWith(Number) })
    .from(publishJobs)
    .where(publishedBetween(companyId, from, to));
  return counted ?? { posts: 0, withNumbers: 0 };
}

// When one company's numbers were last tried, read from a platform, and simulated.
export async function getMetricsActivity(companyId: string): Promise<MetricsActivity> {
  const [attempts, snapshots] = await Promise.all([
    db.select({ last: max(publishJobs.metricsAttemptedAt) }).from(publishJobs).where(eq(publishJobs.companyId, companyId)),
    db
      .select({
        lastCollected: sql<Date | null>`max(${postMetrics.collectedAt}) filter (where ${postMetrics.source} = 'platform')`.mapWith(postMetrics.collectedAt),
        lastSimulated: sql<Date | null>`max(${postMetrics.collectedAt}) filter (where ${postMetrics.source} = 'dev_simulated')`.mapWith(postMetrics.collectedAt),
      })
      .from(postMetrics)
      .where(eq(postMetrics.companyId, companyId)),
  ]);
  return { lastAttemptAt: attempts[0]?.last ?? null, lastCollectedAt: snapshots[0]?.lastCollected ?? null, lastSimulatedAt: snapshots[0]?.lastSimulated ?? null };
}

async function listPublishedPosts(companyId: string, from: Date, to: Date, limit: number, onlyWithNumbers: boolean): Promise<PublishedPost[]> {
  // The post's newest snapshot (LATERAL: one index lookup per post).
  const latest = db
    .select({
      collectedAt: postMetrics.collectedAt,
      source: postMetrics.source,
      views: postMetrics.views,
      reach: postMetrics.reach,
      reactions: postMetrics.reactions,
      comments: postMetrics.comments,
      shares: postMetrics.shares,
      clicks: postMetrics.clicks,
      videoViews: postMetrics.videoViews,
    })
    .from(postMetrics)
    .where(and(eq(postMetrics.companyId, companyId), eq(postMetrics.publishJobId, publishJobs.id)))
    .orderBy(desc(postMetrics.collectedAt), desc(postMetrics.createdAt))
    .limit(1)
    .as("latest");
  const rows = await db
    .select({
      jobId: publishJobs.id,
      draftId: publishJobs.draftId,
      topic: contentDrafts.topic,
      platform: contentDrafts.platform,
      format: contentDrafts.format,
      pillar: contentDrafts.pillar,
      accountName: socialConnections.displayName,
      accountIsStandIn: socialConnections.isStandIn,
      publishedAt: publishJobs.publishedAt,
      externalPostId: publishJobs.externalPostId,
      metricsAttemptedAt: publishJobs.metricsAttemptedAt,
      metricsError: publishJobs.metricsError,
      latestCollectedAt: latest.collectedAt,
      latestSource: latest.source,
      latestViews: latest.views,
      latestReach: latest.reach,
      latestReactions: latest.reactions,
      latestComments: latest.comments,
      latestShares: latest.shares,
      latestClicks: latest.clicks,
      latestVideoViews: latest.videoViews,
    })
    .from(publishJobs)
    .innerJoin(contentDrafts, and(eq(contentDrafts.companyId, publishJobs.companyId), eq(contentDrafts.id, publishJobs.draftId)))
    .leftJoin(socialConnections, and(eq(socialConnections.companyId, publishJobs.companyId), eq(socialConnections.id, publishJobs.connectionId)))
    .leftJoinLateral(latest, sql`true`)
    .where(and(publishedBetween(companyId, from, to), onlyWithNumbers ? isNotNull(latest.collectedAt) : undefined))
    .orderBy(desc(publishJobs.publishedAt), desc(publishJobs.id))
    .limit(limit);
  return rows.map((row) => ({
    jobId: row.jobId,
    draftId: row.draftId,
    topic: row.topic,
    platform: row.platform,
    format: row.format,
    pillar: row.pillar,
    accountName: row.accountName,
    accountIsStandIn: row.accountIsStandIn ?? false,
    // Every published post has its time (a CHECK); the epoch is never shown.
    publishedAt: row.publishedAt ?? new Date(0),
    hasPlatformId: row.externalPostId !== null,
    metricsAttemptedAt: row.metricsAttemptedAt,
    metricsError: row.metricsError,
    latest: toLatest(row),
  }));
}

type LatestColumns = {
  latestCollectedAt: Date | null;
  latestSource: PostMetricSource | null;
  latestViews: number | null;
  latestReach: number | null;
  latestReactions: number | null;
  latestComments: number | null;
  latestShares: number | null;
  latestClicks: number | null;
  latestVideoViews: number | null;
};

// The newest snapshot's columns as one value, or null without a snapshot.
function toLatest(row: LatestColumns): LatestMetrics | null {
  if (!row.latestCollectedAt || !row.latestSource) {
    return null;
  }
  const values = {
    views: row.latestViews,
    reach: row.latestReach,
    reactions: row.latestReactions,
    comments: row.latestComments,
    shares: row.latestShares,
    clicks: row.latestClicks,
    video_views: row.latestVideoViews,
  };
  return { collectedAt: row.latestCollectedAt, source: row.latestSource, values };
}

function publishedBetween(companyId: string, from: Date, to: Date): SQL | undefined {
  return and(eq(publishJobs.companyId, companyId), eq(publishJobs.status, "published"), gte(publishJobs.publishedAt, from), lt(publishJobs.publishedAt, to));
}
