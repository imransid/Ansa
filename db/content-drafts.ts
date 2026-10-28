import "server-only";
import { and, desc, eq, ne, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { ContentDraftStatus, ContentFormat } from "@/lib/content-studio/formats";
import { PAGE_SIZE, pageOffset } from "@/lib/pagination";
import type { SocialPlatform } from "@/lib/social-platforms";
import type { ContentDraftListQuery, ContentDraftPlatformFilter, ContentDraftStatusFilter } from "@/lib/validation/list-queries";
import { db } from "./client";
import { contentDrafts, users, type UserRole } from "./schema";

// Reading one company's content drafts (step 38): the studio's list and its
// counts, and one draft with who made, changed, approved or rejected it.
// Writes: db/content-draft-writes.ts; approving, rejecting, archiving and
// restoring: db/content-draft-status.ts.

export type ContentDraftListItem = {
  id: string;
  topic: string;
  platform: SocialPlatform;
  format: ContentFormat;
  status: ContentDraftStatus;
  version: number;
  updatedAt: Date;
  updatedByName: string | null;
};

export type ContentDraftStatusCounts = Record<ContentDraftStatusFilter, number>;

export type ContentDraftDetail = Omit<ContentDraftListItem, "updatedByName"> & {
  pillar: string;
  campaign: string;
  title: string;
  body: string;
  hashtags: string[];
  callToAction: string;
  imagePrompt: string;
  videoScript: string;
  // The image or video attached from the media library (step 39), or null.
  mediaAssetId: string | null;
  generatedVersion: number | null;
  // As stored: the services read them with lib/content-studio/claims.ts.
  claims: unknown;
  factsUsed: unknown;
  knowledgeUsed: string[];
  planVersion: number | null;
  createdAt: Date;
  createdByName: string | null;
  updatedByName: string | null;
  approvedAt: Date | null;
  approvedVersion: number | null;
  approvedByName: string | null;
  // The approver's role and removal now (step 41): an approval by someone
  // made a member or removed since lets nothing go out.
  approverRole: UserRole | null;
  approverDeactivatedAt: Date | null;
  claimsAcknowledgedAt: Date | null;
  rejectedAt: Date | null;
  rejectedByName: string | null;
  rejectionNote: string | null;
  // When it should go out (the calendar, step 41); null: not planned.
  plannedFor: Date | null;
};

// Views of the users table: who made it, changed it last, approved it,
// rejected it. Every join also matches company_id, so a name from another
// company can never show up (the foreign keys already prevent that link).
const creator = alias(users, "creator");
const updater = alias(users, "updater");
const approver = alias(users, "approver");
const rejecter = alias(users, "rejecter");

// Lists one page of one company's drafts, last changed first.
export async function getContentDraftsForCompany(companyId: string, query: ContentDraftListQuery, page: number): Promise<ContentDraftListItem[]> {
  return db
    .select({
      id: contentDrafts.id,
      topic: contentDrafts.topic,
      platform: contentDrafts.platform,
      format: contentDrafts.format,
      status: contentDrafts.status,
      version: contentDrafts.version,
      updatedAt: contentDrafts.updatedAt,
      updatedByName: updater.name,
    })
    .from(contentDrafts)
    .leftJoin(updater, and(eq(updater.id, contentDrafts.updatedByUserId), eq(updater.companyId, contentDrafts.companyId)))
    .where(draftListWhere(companyId, query))
    .orderBy(desc(contentDrafts.updatedAt), desc(contentDrafts.id))
    .limit(PAGE_SIZE)
    .offset(pageOffset(page));
}

// Counts one company's drafts by status on one platform (or all): the
// numbers on the status links and "Page 2 of 5".
export async function countContentDraftsPerStatus(companyId: string, platform: ContentDraftPlatformFilter): Promise<ContentDraftStatusCounts> {
  const [counts] = await db
    .select({
      current: countWhere(ne(contentDrafts.status, "archived")),
      idea: countWhere(eq(contentDrafts.status, "idea")),
      draft: countWhere(eq(contentDrafts.status, "draft")),
      approved: countWhere(eq(contentDrafts.status, "approved")),
      rejected: countWhere(eq(contentDrafts.status, "rejected")),
      scheduled: countWhere(eq(contentDrafts.status, "scheduled")),
      published: countWhere(eq(contentDrafts.status, "published")),
      failed: countWhere(eq(contentDrafts.status, "failed")),
      archived: countWhere(eq(contentDrafts.status, "archived")),
    })
    .from(contentDrafts)
    .where(draftListWhere(companyId, { status: "all", platform }));
  return counts ?? { current: 0, idea: 0, draft: 0, approved: 0, rejected: 0, scheduled: 0, published: 0, failed: 0, archived: 0 };
}

// Reads one draft of one company, or undefined (unknown, or another company's).
export async function getContentDraftForCompany(companyId: string, draftId: string): Promise<ContentDraftDetail | undefined> {
  const [draft] = await db
    .select({
      id: contentDrafts.id,
      topic: contentDrafts.topic,
      platform: contentDrafts.platform,
      format: contentDrafts.format,
      status: contentDrafts.status,
      version: contentDrafts.version,
      pillar: contentDrafts.pillar,
      campaign: contentDrafts.campaign,
      title: contentDrafts.title,
      body: contentDrafts.body,
      hashtags: contentDrafts.hashtags,
      callToAction: contentDrafts.callToAction,
      imagePrompt: contentDrafts.imagePrompt,
      videoScript: contentDrafts.videoScript,
      mediaAssetId: contentDrafts.mediaAssetId,
      generatedVersion: contentDrafts.generatedVersion,
      claims: contentDrafts.claims,
      factsUsed: contentDrafts.factsUsed,
      knowledgeUsed: contentDrafts.knowledgeUsed,
      planVersion: contentDrafts.planVersion,
      createdAt: contentDrafts.createdAt,
      createdByName: creator.name,
      updatedAt: contentDrafts.updatedAt,
      updatedByName: updater.name,
      approvedAt: contentDrafts.approvedAt,
      approvedVersion: contentDrafts.approvedVersion,
      approvedByName: approver.name,
      approverRole: approver.role,
      approverDeactivatedAt: approver.deactivatedAt,
      claimsAcknowledgedAt: contentDrafts.claimsAcknowledgedAt,
      rejectedAt: contentDrafts.rejectedAt,
      rejectedByName: rejecter.name,
      rejectionNote: contentDrafts.rejectionNote,
      plannedFor: contentDrafts.plannedFor,
    })
    .from(contentDrafts)
    .leftJoin(creator, and(eq(creator.id, contentDrafts.createdByUserId), eq(creator.companyId, contentDrafts.companyId)))
    .leftJoin(updater, and(eq(updater.id, contentDrafts.updatedByUserId), eq(updater.companyId, contentDrafts.companyId)))
    .leftJoin(approver, and(eq(approver.id, contentDrafts.approvedByUserId), eq(approver.companyId, contentDrafts.companyId)))
    .leftJoin(rejecter, and(eq(rejecter.id, contentDrafts.rejectedByUserId), eq(rejecter.companyId, contentDrafts.companyId)))
    .where(and(eq(contentDrafts.companyId, companyId), eq(contentDrafts.id, draftId)));
  return draft;
}

// The WHERE of the list and its counts: ALWAYS the company first, then the
// status ("current": all but archived; "all": every one, for the counts)
// and the platform.
function draftListWhere(companyId: string, query: { status: ContentDraftStatusFilter | "all"; platform: ContentDraftPlatformFilter }): SQL | undefined {
  return and(
    eq(contentDrafts.companyId, companyId),
    statusCondition(query.status),
    query.platform === "all" ? undefined : eq(contentDrafts.platform, query.platform),
  );
}

function statusCondition(status: ContentDraftStatusFilter | "all"): SQL | undefined {
  if (status === "all") {
    return undefined;
  }
  return status === "current" ? ne(contentDrafts.status, "archived") : eq(contentDrafts.status, status);
}

// Counts only the rows that match, in the same pass over the table as the
// other counts.
function countWhere(condition: SQL | undefined) {
  return sql<number>`count(*) filter (where ${condition ?? sql`true`})`.mapWith(Number);
}
