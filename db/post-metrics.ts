import "server-only";
import { and, asc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { METRICS_READ_DAYS, metricsReadDays, type PostMetricValues } from "@/lib/metric-definitions";
import type { SocialPlatform } from "@/lib/social-platforms";
import { db } from "./client";
import { postMetrics, publishJobs, socialConnections } from "./schema";
import { markNeedsReauthWithin } from "./social-connection-tokens";

// Reading the numbers of published posts (step 42). The collector CLAIMS
// one post at a time in ONE UPDATE (metrics_attempted_at = now), so the
// daily job and /api/cron/publish running at once never read the same post
// twice, then saves what came back in one transaction: a snapshot, or the
// failure's code on the job (never a snapshot). updated_at is never
// touched: the queue lists published posts by it.

// A post is read again once its last try is this old: about a day, a
// little less so a daily job at a fixed hour always finds it due. Posts
// are read for metricsReadDays after they went out (30 days, X's 28).
export const METRICS_INTERVAL_HOURS = 20;
// A post is first read once it has been out this long: a snapshot of a
// post a minute old says nothing, and on X every read is paid.
export const METRICS_FIRST_READ_MINUTES = 60;

export type MetricsClaim = {
  companyId: string;
  jobId: string;
  connectionId: string;
  platform: SocialPlatform;
  externalPostId: string;
  publishedAt: Date;
};

// The platforms whose posts are read (lib/metric-definitions.ts), and only
// onlyCompanyIds' when given (the checks keep to their own companies).
export type MetricsScope = { platforms: SocialPlatform[]; onlyCompanyIds?: string[] };

// Claims the post of any company that waited longest for its numbers, in
// ONE UPDATE ("id = (SELECT ... FOR UPDATE SKIP LOCKED)", a scalar
// subquery, as db/publish-runs.ts claims due posts). Never a development
// stand-in's post (its numbers come from pnpm simulate:post-metrics). Not
// company-scoped on purpose: the runners have no session and serve every
// company; the work then runs through company-scoped paths with the row's
// own company.
export async function claimNextPostForMetrics(scope: MetricsScope): Promise<MetricsClaim | undefined> {
  if (scope.platforms.length === 0) {
    return undefined;
  }
  const next = db
    .select({ id: publishJobs.id })
    .from(publishJobs)
    .innerJoin(socialConnections, connectionOfJob())
    .where(isDueIn(scope))
    .orderBy(sql`${publishJobs.metricsAttemptedAt} asc nulls first`, asc(publishJobs.publishedAt), asc(publishJobs.id))
    .limit(1)
    .for("update", { of: publishJobs, skipLocked: true });
  const [claimed] = await db
    .update(publishJobs)
    .set({ metricsAttemptedAt: sql`now()` })
    .from(socialConnections)
    .where(and(eq(publishJobs.id, sql`(${next})`), connectionOfJob(), isDueIn(scope)))
    .returning({
      companyId: publishJobs.companyId,
      jobId: publishJobs.id,
      connectionId: publishJobs.connectionId,
      platform: socialConnections.platform,
      externalPostId: publishJobs.externalPostId,
      publishedAt: publishJobs.publishedAt,
    });
  // Both are set on every due post (isDueIn); the check satisfies the types.
  if (!claimed?.externalPostId || !claimed.publishedAt) {
    return undefined;
  }
  return { ...claimed, externalPostId: claimed.externalPostId, publishedAt: claimed.publishedAt };
}

// Whether a post still waits for its numbers in the scope: a runner that
// stopped at its limit says so in the log. Cross-company like the claim.
export async function hasPostDueForMetrics(scope: MetricsScope): Promise<boolean> {
  if (scope.platforms.length === 0) {
    return false;
  }
  const [due] = await db.select({ id: publishJobs.id }).from(publishJobs).innerJoin(socialConnections, connectionOfJob()).where(isDueIn(scope)).limit(1);
  return due !== undefined;
}

// Saves the numbers the platform gave for one company's published post,
// and clears the last failure, in one transaction. False: no such
// published post of this company.
export async function saveCollectedMetrics(companyId: string, jobId: string, values: PostMetricValues): Promise<boolean> {
  return db.transaction(async (tx) => {
    const cleared = await tx
      .update(publishJobs)
      .set({ metricsError: null })
      .where(and(eq(publishJobs.companyId, companyId), eq(publishJobs.id, jobId), eq(publishJobs.status, "published")))
      .returning({ id: publishJobs.id });
    if (cleared.length === 0) {
      return false;
    }
    await tx.insert(postMetrics).values(snapshotRow(companyId, jobId, values, "platform"));
    return true;
  });
}

// Why one company's post got no numbers, on the job (never a snapshot).
// tokenRejected: the platform refused the account's token, so the account
// is marked as needing a reconnect too, while it still holds the token the
// run used (as publishing does, db/publish-outcomes.ts).
export async function recordMetricsFailure(companyId: string, jobId: string, code: string, tokenRejected: { storedAccessToken: string } | null): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [failed] = await tx
      .update(publishJobs)
      .set({ metricsError: code, metricsAttemptedAt: sql`coalesce(${publishJobs.metricsAttemptedAt}, now())` })
      .where(and(eq(publishJobs.companyId, companyId), eq(publishJobs.id, jobId), eq(publishJobs.status, "published")))
      .returning({ connectionId: publishJobs.connectionId });
    if (!failed) {
      return false;
    }
    if (tokenRejected) {
      await markNeedsReauthWithin(tx, companyId, failed.connectionId, tokenRejected.storedAccessToken, "token_rejected");
    }
    return true;
  });
}

// Every column named, never a spread of what was passed in.
export function snapshotRow(companyId: string, jobId: string, values: PostMetricValues, source: "platform" | "dev_simulated") {
  return {
    companyId,
    publishJobId: jobId,
    collectedAt: sql`now()`,
    views: values.views,
    reach: values.reach,
    reactions: values.reactions,
    comments: values.comments,
    shares: values.shares,
    clicks: values.clicks,
    videoViews: values.video_views,
    source,
  };
}

function connectionOfJob(): SQL | undefined {
  return and(eq(socialConnections.companyId, publishJobs.companyId), eq(socialConnections.id, publishJobs.connectionId));
}

// A published post of a platform in the scope, out at least an hour and
// no longer than its platform's numbers are read, with the platform's id
// of it (a post marked published by hand has none), not read in the last
// 20 hours, not a stand-in's.
function isDueIn(scope: MetricsScope): SQL | undefined {
  return and(
    eq(publishJobs.status, "published"),
    sql`${publishJobs.externalPostId} is not null`,
    // No platform's posts are read for longer. WHY on its own: Postgres
    // then reads only these days from publish_jobs_published_at_idx (the
    // condition below names the account's platform, another table).
    sql`${publishJobs.publishedAt} >= now() - make_interval(days => ${METRICS_READ_DAYS})`,
    isOfPlatformStillRead(scope.platforms),
    sql`${publishJobs.publishedAt} <= now() - make_interval(mins => ${METRICS_FIRST_READ_MINUTES})`,
    sql`(${publishJobs.metricsAttemptedAt} is null or ${publishJobs.metricsAttemptedAt} < now() - make_interval(hours => ${METRICS_INTERVAL_HOURS}))`,
    eq(socialConnections.isStandIn, false),
    scope.onlyCompanyIds ? inArray(publishJobs.companyId, scope.onlyCompanyIds) : undefined,
  );
}

// A post of one of the platforms, out no longer than that platform's
// numbers are read (lib/metric-definitions.ts: 30 days, X's 28).
function isOfPlatformStillRead(platforms: SocialPlatform[]): SQL {
  const perPlatform = platforms.map((platform) =>
    and(eq(socialConnections.platform, platform), sql`${publishJobs.publishedAt} >= now() - make_interval(days => ${metricsReadDays(platform)})`),
  );
  // No platform: no post (an empty OR would be no condition at all).
  return or(...perPlatform) ?? sql`false`;
}
