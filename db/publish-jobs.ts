import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, ne, notInArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { ContentFormat } from "@/lib/content-studio/formats";
import { LIVE_JOB_STATUSES, publishJobStatuses, type PublishApprovalMode, type PublishJobStatus } from "@/lib/publishing/kinds";
import type { SocialConnectionStatus, SocialPlatform } from "@/lib/social-platforms";
import { db } from "./client";
import { isCutOffWhileSending } from "./publish-runs";
import { autopublishRules, contentDrafts, publishJobs, socialConnections, users } from "./schema";

// Reading one company's publish jobs (step 41) for its pages: the queue by
// status, a draft's own, the calendar's weeks (its planned drafts:
// db/content-calendar.ts), the Analytics page's problems (step 42), and
// one job. Writes:
// db/publish-scheduling.ts, db/publish-job-actions.ts, db/publish-runs.ts,
// db/publish-outcomes.ts. A post cut off while sending (still "publishing"
// 10+ minutes after its claim) is listed and counted as needing attention
// ("interrupted") at once: the runners record that, but on Vercel Hobby the
// next one may be a day away, and a person's Mark or Retry hands it over
// first (handOverCutOffJobWithin, db/publish-runs.ts).

export type PublishJobListItem = {
  id: string;
  status: PublishJobStatus;
  scheduledFor: Date;
  runAfter: Date;
  attempts: number;
  lastError: string | null;
  publishedAt: Date | null;
  externalUrl: string | null;
  approvalMode: PublishApprovalMode;
  approvedVersion: number;
  updatedAt: Date;
  draftId: string;
  draftTopic: string;
  draftPlatform: SocialPlatform;
  draftFormat: ContentFormat;
  connectionId: string;
  connectionName: string | null;
  connectionStatus: SocialConnectionStatus | null;
  connectionIsStandIn: boolean | null;
  createdByName: string | null;
  canceledByName: string | null;
  // For a job under an auto-publish rule: whether the rule is still on.
  ruleEnabled: boolean | null;
  // A failed post whose account has the draft on its way, out or waiting for
  // a check again (scheduled or tried again there since): it no longer
  // counts for the draft, and can't be tried again.
  scheduledAgain: boolean;
};

export type PublishJobCounts = Record<PublishJobStatus, number>;

const creator = alias(users, "creator");
const canceler = alias(users, "canceler");
// Another job of the same draft and account that is on its way, out or
// waiting for a check: at most one (the partial unique index).
const liveSibling = alias(publishJobs, "live_sibling");

// A job's status and code as the pages show them (see the top of the file).
const shownStatus = sql<PublishJobStatus>`case when ${isCutOffWhileSending()} then 'needs_attention' else ${publishJobs.status} end`;
const shownLastError = sql<string | null>`case when ${isCutOffWhileSending()} then 'interrupted' else ${publishJobs.lastError} end`;

// One company's jobs of these statuses: waiting ones by when they are due,
// the others newest first.
export async function getPublishJobsForCompany(companyId: string, statuses: PublishJobStatus[], limit: number): Promise<PublishJobListItem[]> {
  const isWaiting = statuses.every((status) => status === "queued" || status === "publishing");
  const order = isWaiting ? [asc(publishJobs.runAfter), asc(publishJobs.id)] : [desc(publishJobs.updatedAt), desc(publishJobs.id)];
  return listJobs(and(eq(publishJobs.companyId, companyId), inArray(shownStatus, statuses)), limit, order);
}

// One draft's jobs of one company, newest first.
export async function getPublishJobsForDraft(companyId: string, draftId: string, limit: number): Promise<PublishJobListItem[]> {
  return listJobs(and(eq(publishJobs.companyId, companyId), eq(publishJobs.draftId, draftId)), limit, [desc(publishJobs.createdAt), desc(publishJobs.id)]);
}

// One company's jobs (but canceled ones) that go out, or went out, between
// two moments: the calendar's weeks.
export async function getPublishJobsBetween(companyId: string, from: Date, to: Date, limit: number): Promise<PublishJobListItem[]> {
  const where = and(
    eq(publishJobs.companyId, companyId),
    notInArray(publishJobs.status, ["canceled"]),
    gte(publishJobs.scheduledFor, from),
    lt(publishJobs.scheduledFor, to),
  );
  return listJobs(where, limit, [asc(publishJobs.scheduledFor), asc(publishJobs.id)]);
}

// One company's posts that failed or need attention (a cut-off one too),
// whose last change was between two moments, newest first: the Analytics
// page's publishing problems of its period (step 42).
export async function getPublishingProblemsBetween(companyId: string, from: Date, to: Date, limit: number): Promise<PublishJobListItem[]> {
  const where = and(eq(publishJobs.companyId, companyId), inArray(shownStatus, ["failed", "needs_attention"]), gte(publishJobs.updatedAt, from), lt(publishJobs.updatedAt, to));
  return listJobs(where, limit, [desc(publishJobs.updatedAt), desc(publishJobs.id)]);
}

// How many jobs of each status one company has, as the pages show them (a
// post cut off while sending needs attention).
export async function countPublishJobsPerStatus(companyId: string): Promise<PublishJobCounts> {
  const rows = await db
    .select({
      status: publishJobs.status,
      count: sql<number>`count(*)`.mapWith(Number),
      cutOff: sql<number>`count(*) filter (where ${isCutOffWhileSending()})`.mapWith(Number),
    })
    .from(publishJobs)
    .where(eq(publishJobs.companyId, companyId))
    .groupBy(publishJobs.status);
  const counts = Object.fromEntries(publishJobStatuses.map((status) => [status, 0])) as PublishJobCounts;
  for (const row of rows) {
    counts[row.status] += row.count - row.cutOff;
    counts.needs_attention += row.cutOff;
  }
  return counts;
}

// One job of one company: what a service needs before changing it.
export async function getPublishJobForCompany(
  companyId: string,
  jobId: string,
): Promise<{ draftId: string; platform: SocialPlatform; status: PublishJobStatus } | undefined> {
  const [job] = await db
    .select({ draftId: publishJobs.draftId, platform: socialConnections.platform, status: publishJobs.status })
    .from(publishJobs)
    .innerJoin(socialConnections, and(eq(socialConnections.companyId, publishJobs.companyId), eq(socialConnections.id, publishJobs.connectionId)))
    .where(and(eq(publishJobs.companyId, companyId), eq(publishJobs.id, jobId)));
  return job;
}

// WHERE: always the company first (the callers above). Every join also
// matches company_id, so nothing of another company can show up.
async function listJobs(where: SQL | undefined, limit: number, order: SQL[]): Promise<PublishJobListItem[]> {
  return db
    .select({
      id: publishJobs.id,
      status: shownStatus,
      scheduledFor: publishJobs.scheduledFor,
      runAfter: publishJobs.runAfter,
      attempts: publishJobs.attempts,
      lastError: shownLastError,
      publishedAt: publishJobs.publishedAt,
      externalUrl: publishJobs.externalUrl,
      approvalMode: publishJobs.approvalMode,
      approvedVersion: publishJobs.approvedVersion,
      updatedAt: publishJobs.updatedAt,
      draftId: publishJobs.draftId,
      draftTopic: contentDrafts.topic,
      draftPlatform: contentDrafts.platform,
      draftFormat: contentDrafts.format,
      connectionId: publishJobs.connectionId,
      connectionName: socialConnections.displayName,
      connectionStatus: socialConnections.status,
      connectionIsStandIn: socialConnections.isStandIn,
      createdByName: creator.name,
      canceledByName: canceler.name,
      ruleEnabled: autopublishRules.enabled,
      scheduledAgain: sql<boolean>`(${publishJobs.status} = 'failed' and ${liveSibling.id} is not null)`,
    })
    .from(publishJobs)
    .innerJoin(contentDrafts, and(eq(contentDrafts.companyId, publishJobs.companyId), eq(contentDrafts.id, publishJobs.draftId)))
    .leftJoin(socialConnections, and(eq(socialConnections.companyId, publishJobs.companyId), eq(socialConnections.id, publishJobs.connectionId)))
    .leftJoin(creator, and(eq(creator.companyId, publishJobs.companyId), eq(creator.id, publishJobs.createdByUserId)))
    .leftJoin(canceler, and(eq(canceler.companyId, publishJobs.companyId), eq(canceler.id, publishJobs.canceledByUserId)))
    .leftJoin(autopublishRules, and(eq(autopublishRules.companyId, publishJobs.companyId), eq(autopublishRules.id, publishJobs.autopublishRuleId)))
    .leftJoin(
      liveSibling,
      and(
        eq(liveSibling.companyId, publishJobs.companyId),
        eq(liveSibling.draftId, publishJobs.draftId),
        eq(liveSibling.connectionId, publishJobs.connectionId),
        ne(liveSibling.id, publishJobs.id),
        inArray(liveSibling.status, [...LIVE_JOB_STATUSES]),
      ),
    )
    .where(where)
    .orderBy(...order)
    .limit(limit);
}
