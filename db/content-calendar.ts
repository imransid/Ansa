import "server-only";
import { and, asc, eq, gte, lt, notInArray } from "drizzle-orm";
import { canPlanContentCalendar } from "@/lib/cofounder/permissions";
import type { ContentDraftStatus, ContentFormat } from "@/lib/content-studio/formats";
import type { SocialPlatform } from "@/lib/social-platforms";
import { db } from "./client";
import { recordActivity } from "./cofounder-activity";
import { lockActiveAuthorRole } from "./knowledge-author";
import { contentDrafts } from "./schema";

// The calendar's drafts (step 41): "Plan the next 2 weeks" saves the AI's
// ideas for one company as drafts in status idea, each with its topic,
// platform, format, the plan's pillar and campaign, and when it is planned
// for. Nothing written, approved or scheduled: the team writes each one
// later. Owners only: the role is read again, locked, in the transaction
// (db/knowledge-author.ts says why). The calendar's posts:
// db/publish-jobs.ts.

export type PlannedIdea = {
  platform: SocialPlatform;
  format: ContentFormat;
  topic: string;
  pillar: string;
  campaign: string;
  plannedFor: Date;
};

// Saves every idea, or none, each recorded in the activity log.
export async function savePlannedIdeas(
  companyId: string,
  actorUserId: string,
  ideas: PlannedIdea[],
): Promise<{ outcome: "saved"; draftIds: string[] } | { outcome: "not-allowed" }> {
  return db.transaction(async (tx) => {
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    if (!role || !canPlanContentCalendar(role)) {
      return { outcome: "not-allowed" };
    }
    const draftIds: string[] = [];
    // Every column named, never a spread of what was passed in.
    for (const idea of ideas) {
      const [created] = await tx
        .insert(contentDrafts)
        .values({
          companyId,
          platform: idea.platform,
          format: idea.format,
          topic: idea.topic,
          pillar: idea.pillar,
          campaign: idea.campaign,
          status: "idea",
          version: 1,
          plannedFor: idea.plannedFor,
          createdByUserId: actorUserId,
          updatedByUserId: actorUserId,
        })
        .returning({ id: contentDrafts.id });
      draftIds.push(created.id);
    }
    await recordActivity(
      tx,
      companyId,
      draftIds.map((draftId) => ({ action: "idea_planned" as const, actorUserId, draftId })),
    );
    return { outcome: "saved", draftIds };
  });
}

// One company's drafts planned between two moments that aren't on their
// way yet (scheduled, published or failed ones show as their jobs), and
// aren't archived: the calendar's ideas and drafts.
export async function getPlannedDraftsBetween(
  companyId: string,
  from: Date,
  to: Date,
  limit: number,
): Promise<{ id: string; topic: string; platform: SocialPlatform; format: ContentFormat; status: ContentDraftStatus; plannedFor: Date }[]> {
  const rows = await db
    .select({
      id: contentDrafts.id,
      topic: contentDrafts.topic,
      platform: contentDrafts.platform,
      format: contentDrafts.format,
      status: contentDrafts.status,
      plannedFor: contentDrafts.plannedFor,
    })
    .from(contentDrafts)
    .where(
      and(
        eq(contentDrafts.companyId, companyId),
        notInArray(contentDrafts.status, ["scheduled", "published", "failed", "archived"]),
        gte(contentDrafts.plannedFor, from),
        lt(contentDrafts.plannedFor, to),
      ),
    )
    .orderBy(asc(contentDrafts.plannedFor), asc(contentDrafts.id))
    .limit(limit);
  return rows.flatMap((row) => (row.plannedFor ? [{ ...row, plannedFor: row.plannedFor }] : []));
}
