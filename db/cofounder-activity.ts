import "server-only";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { CofounderActivityAction } from "@/lib/publishing/activity-actions";
import type { SocialPlatform } from "@/lib/social-platforms";
import { db, type DbTransaction } from "./client";
import { autopublishRules, cofounderActivity, contentDrafts, socialConnections, users } from "./schema";

// The Co-Founder's activity log (step 41): rows written inside the
// transaction of the change they record, by the /db function making it, and
// the lists the queue page and a draft's page show. Rows are only ever added.

export type ActivityEntry = {
  action: CofounderActivityAction;
  // Who did it; null = the app.
  actorUserId: string | null;
  draftId?: string | null;
  jobId?: string | null;
  connectionId?: string | null;
  ruleId?: string | null;
  planVersion?: number | null;
  code?: string | null;
};

export type ActivityListItem = {
  id: string;
  action: CofounderActivityAction;
  code: string | null;
  createdAt: Date;
  // Empty: the app did it.
  actorUserId: string | null;
  actorName: string | null;
  draftId: string | null;
  draftTopic: string | null;
  draftPlatform: SocialPlatform | null;
  jobId: string | null;
  connectionPlatform: SocialPlatform | null;
  connectionName: string | null;
  rulePlatform: SocialPlatform | null;
  rulePillar: string | null;
  planVersion: number | null;
};

const actor = alias(users, "actor");

// Records what happened, inside the caller's transaction, one row at a
// time: clock_timestamp() then keeps them in the order they happened.
// Every column named (never a spread of what was passed in).
export async function recordActivity(tx: DbTransaction, companyId: string, entries: ActivityEntry[]): Promise<void> {
  for (const entry of entries) {
    await tx.insert(cofounderActivity).values({
      companyId,
      action: entry.action,
      actorUserId: entry.actorUserId,
      draftId: entry.draftId ?? null,
      jobId: entry.jobId ?? null,
      connectionId: entry.connectionId ?? null,
      ruleId: entry.ruleId ?? null,
      planVersion: entry.planVersion ?? null,
      code: entry.code ?? null,
    });
  }
}

// One company's newest entries, newest first.
export async function listActivityForCompany(companyId: string, limit: number): Promise<ActivityListItem[]> {
  return listActivity(eq(cofounderActivity.companyId, companyId), limit);
}

// One draft's newest entries of one company, newest first.
export async function listActivityForDraft(companyId: string, draftId: string, limit: number): Promise<ActivityListItem[]> {
  return listActivity(and(eq(cofounderActivity.companyId, companyId), eq(cofounderActivity.draftId, draftId)), limit);
}

// WHERE: always the company first (the callers above). Every join also
// matches company_id, so nothing of another company can show up (the
// foreign keys already refuse such a link).
async function listActivity(where: SQL | undefined, limit: number): Promise<ActivityListItem[]> {
  return db
    .select({
      id: cofounderActivity.id,
      action: cofounderActivity.action,
      code: cofounderActivity.code,
      createdAt: cofounderActivity.createdAt,
      actorUserId: cofounderActivity.actorUserId,
      actorName: actor.name,
      draftId: cofounderActivity.draftId,
      draftTopic: contentDrafts.topic,
      draftPlatform: contentDrafts.platform,
      jobId: cofounderActivity.jobId,
      connectionPlatform: socialConnections.platform,
      connectionName: socialConnections.displayName,
      rulePlatform: autopublishRules.platform,
      rulePillar: autopublishRules.pillar,
      planVersion: cofounderActivity.planVersion,
    })
    .from(cofounderActivity)
    .leftJoin(actor, and(eq(actor.companyId, cofounderActivity.companyId), eq(actor.id, cofounderActivity.actorUserId)))
    .leftJoin(contentDrafts, and(eq(contentDrafts.companyId, cofounderActivity.companyId), eq(contentDrafts.id, cofounderActivity.draftId)))
    .leftJoin(socialConnections, and(eq(socialConnections.companyId, cofounderActivity.companyId), eq(socialConnections.id, cofounderActivity.connectionId)))
    .leftJoin(autopublishRules, and(eq(autopublishRules.companyId, cofounderActivity.companyId), eq(autopublishRules.id, cofounderActivity.ruleId)))
    .where(where)
    .orderBy(desc(cofounderActivity.createdAt), desc(cofounderActivity.id))
    .limit(limit);
}
