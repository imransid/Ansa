import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { FactValue, StoredClaim } from "@/lib/content-studio/claims";
import { keepUsedFields, statusAfterContentChange, type ContentFields } from "@/lib/content-studio/draft-fields";
import type { ContentFormat } from "@/lib/content-studio/formats";
import type { SocialPlatform } from "@/lib/social-platforms";
import { db } from "./client";
import { contentColumns, lockDraft, NO_APPROVAL, refuseContentChange, type LockedDraft } from "./content-draft-rows";
import { lockActiveAuthorRole } from "./knowledge-author";
import { cancelQueuedJobsAfterChange } from "./publish-draft-sync";
import { contentDrafts } from "./schema";

// Writing one company's content drafts (step 38): a new draft (blank, or
// written by the AI), a person's edit, and new text from the AI for a draft
// that exists. Every change of content is a new version and clears any
// approval in the SAME UPDATE, so an approved draft is always exactly what
// its owner approved; in the same transaction its waiting posts are
// canceled and the change recorded (step 41, db/publish-draft-sync.ts).
// Anyone active in the company writes: the role is read again, locked, in
// each transaction (db/knowledge-author.ts says why).
// Approving, rejecting, archiving, restoring: db/content-draft-status.ts.

// What the draft is about: its topic, and the plan's pillar and campaign.
export type DraftPlacement = { topic: string; pillar: string; campaign: string };

// What the AI wrote, and what its request held.
export type GeneratedDraft = {
  fields: ContentFields;
  claims: StoredClaim[];
  factsUsed: FactValue[];
  knowledgeUsed: string[];
  planVersion: number | null;
};

export type NewContentDraft = DraftPlacement & { platform: SocialPlatform; format: ContentFormat; generated: GeneratedDraft | null };

export type CreateDraftOutcome = { outcome: "created"; draftId: string } | { outcome: "not-allowed" };

// "stale": the version is no longer the one the person saw (someone changed
// the draft meanwhile). "wrong-status": the change can't start from the
// draft's status (it is archived, or another owner changed it meanwhile).
export type DraftChangeOutcome = "changed" | "unchanged" | "not-found" | "not-allowed" | "stale" | "wrong-status";

const NOTHING_WRITTEN: ContentFields = { title: "", body: "", hashtags: [], callToAction: "", imagePrompt: "", videoScript: "" };

// Saves a new draft of one company, version 1, made by actorUserId: an idea
// (only its topic) when started blank, a draft when the AI wrote it.
export async function createContentDraft(companyId: string, actorUserId: string, draft: NewContentDraft): Promise<CreateDraftOutcome> {
  return db.transaction(async (tx) => {
    if (!(await lockActiveAuthorRole(tx, companyId, actorUserId))) {
      return { outcome: "not-allowed" };
    }
    const fields = keepUsedFields(draft.platform, draft.format, draft.generated?.fields ?? NOTHING_WRITTEN);
    // Every column named, never a spread of what was passed in: a company,
    // status or approval can't ride along.
    const [created] = await tx
      .insert(contentDrafts)
      .values({
        companyId,
        platform: draft.platform,
        format: draft.format,
        topic: draft.topic,
        pillar: draft.pillar,
        campaign: draft.campaign,
        ...contentColumns(fields),
        // Nothing is attached yet: the media library attaches (step 39).
        status: statusAfterContentChange(fields, false),
        version: 1,
        generatedVersion: draft.generated ? 1 : null,
        claims: draft.generated?.claims ?? [],
        factsUsed: draft.generated?.factsUsed ?? [],
        knowledgeUsed: draft.generated?.knowledgeUsed ?? [],
        planVersion: draft.generated?.planVersion ?? null,
        createdByUserId: actorUserId,
        updatedByUserId: actorUserId,
      })
      .returning({ id: contentDrafts.id });
    return { outcome: "created", draftId: created.id };
  });
}

// Saves a person's edit of one draft of one company, when nobody changed it
// since the version they opened. Nothing different from what is stored =
// "unchanged" (no new version, the approval stays).
export async function editContentDraft(
  companyId: string,
  actorUserId: string,
  edit: { draftId: string; version: number; placement: DraftPlacement; fields: ContentFields },
): Promise<DraftChangeOutcome> {
  return db.transaction(async (tx) => {
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    const current = await lockDraft(tx, companyId, edit.draftId);
    if (!current) {
      return "not-found";
    }
    const refusal = refuseContentChange(current, role !== null, edit.version);
    if (refusal) {
      return refusal;
    }
    const fields = keepUsedFields(current.platform, current.format, edit.fields);
    if (!differs(current, edit.placement, fields)) {
      return "unchanged";
    }
    await tx
      .update(contentDrafts)
      .set({
        topic: edit.placement.topic,
        pillar: edit.placement.pillar,
        campaign: edit.placement.campaign,
        ...contentColumns(fields),
        status: statusAfterContentChange(fields, current.mediaAssetId !== null),
        version: sql`${contentDrafts.version} + 1`,
        ...NO_APPROVAL,
        updatedByUserId: actorUserId,
        updatedAt: sql`now()`,
      })
      .where(and(eq(contentDrafts.companyId, companyId), eq(contentDrafts.id, edit.draftId), eq(contentDrafts.version, edit.version)));
    await cancelQueuedJobsAfterChange(tx, companyId, actorUserId, { id: edit.draftId, approvedByUserId: current.approvedByUserId });
    return "changed";
  });
}

// Saves the AI's new text for one draft of one company as its next version,
// when nobody changed the draft since the version the person regenerated
// (the AI takes a while: an edit saved meanwhile is never replaced unseen).
export async function saveRegeneratedDraft(
  companyId: string,
  actorUserId: string,
  regeneration: { draftId: string; version: number; generated: GeneratedDraft },
): Promise<DraftChangeOutcome> {
  return db.transaction(async (tx) => {
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    const current = await lockDraft(tx, companyId, regeneration.draftId);
    if (!current) {
      return "not-found";
    }
    const refusal = refuseContentChange(current, role !== null, regeneration.version);
    if (refusal) {
      return refusal;
    }
    const { generated } = regeneration;
    const fields = keepUsedFields(current.platform, current.format, generated.fields);
    const nextVersion = regeneration.version + 1;
    await tx
      .update(contentDrafts)
      .set({
        ...contentColumns(fields),
        status: statusAfterContentChange(fields, current.mediaAssetId !== null),
        version: nextVersion,
        generatedVersion: nextVersion,
        claims: generated.claims,
        factsUsed: generated.factsUsed,
        knowledgeUsed: generated.knowledgeUsed,
        planVersion: generated.planVersion,
        ...NO_APPROVAL,
        updatedByUserId: actorUserId,
        updatedAt: sql`now()`,
      })
      .where(and(eq(contentDrafts.companyId, companyId), eq(contentDrafts.id, regeneration.draftId), eq(contentDrafts.version, regeneration.version)));
    await cancelQueuedJobsAfterChange(tx, companyId, actorUserId, { id: regeneration.draftId, approvedByUserId: current.approvedByUserId });
    return "changed";
  });
}

function differs(current: LockedDraft, placement: DraftPlacement, fields: ContentFields): boolean {
  const texts: [string, string][] = [
    [current.topic, placement.topic],
    [current.pillar, placement.pillar],
    [current.campaign, placement.campaign],
    [current.title, fields.title],
    [current.body, fields.body],
    [current.callToAction, fields.callToAction],
    [current.imagePrompt, fields.imagePrompt],
    [current.videoScript, fields.videoScript],
  ];
  const hashtagsDiffer = current.hashtags.join("\n") !== fields.hashtags.join("\n");
  return hashtagsDiffer || texts.some(([stored, edited]) => stored !== edited);
}
