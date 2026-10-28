import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { EDITABLE_STATUSES, type ContentFields } from "@/lib/content-studio/draft-fields";
import type { MediaKind } from "@/lib/media/kinds";
import type { DbTransaction } from "./client";
import type { DraftChangeOutcome } from "./content-draft-writes";
import { contentDrafts, mediaAssets } from "./schema";

// What every change of a content draft (step 38) shares, in
// db/content-draft-writes.ts, db/content-draft-status.ts and
// db/content-draft-media.ts: the draft's row read inside the transaction
// that changes it, locked until it ends, and the columns each change writes.

export type LockedDraft = NonNullable<Awaited<ReturnType<typeof lockDraft>>>;

// What every change of content and every rejection or archiving leaves: no
// approval, no "I checked these claims".
export const NO_APPROVAL = {
  approvedByUserId: null,
  approvedAt: null,
  approvedVersion: null,
  claimsAcknowledgedByUserId: null,
  claimsAcknowledgedAt: null,
};

// One draft of one company with what the changes decide on, its row locked
// FOR UPDATE (undefined: not this company's, or no such draft). Lock order,
// as everywhere: the person's row first (lockActiveAuthorRole), then this.
export async function lockDraft(tx: DbTransaction, companyId: string, draftId: string) {
  const [draft] = await tx
    .select({
      platform: contentDrafts.platform,
      format: contentDrafts.format,
      status: contentDrafts.status,
      version: contentDrafts.version,
      generatedVersion: contentDrafts.generatedVersion,
      topic: contentDrafts.topic,
      pillar: contentDrafts.pillar,
      campaign: contentDrafts.campaign,
      title: contentDrafts.title,
      body: contentDrafts.body,
      hashtags: contentDrafts.hashtags,
      callToAction: contentDrafts.callToAction,
      imagePrompt: contentDrafts.imagePrompt,
      videoScript: contentDrafts.videoScript,
      mediaAssetId: contentDrafts.mediaAssetId,
      claims: contentDrafts.claims,
      factsUsed: contentDrafts.factsUsed,
      // Whether an owner's approval is about to be taken away (step 41's
      // activity log, and the waiting posts it cancels).
      approvedByUserId: contentDrafts.approvedByUserId,
      approvedVersion: contentDrafts.approvedVersion,
    })
    .from(contentDrafts)
    .where(and(eq(contentDrafts.companyId, companyId), eq(contentDrafts.id, draftId)))
    .for("update");
  return draft;
}

// The image or video a locked draft has attached, with its alt text (null:
// none), read within its company. No lock of its own: deleting an asset, or
// changing its alt text, must lock every draft using it first
// (db/media-asset-deletion.ts, db/media-alt-text.ts), so while the draft is
// locked its asset and alt text stay as read.
export async function attachedMedia(tx: DbTransaction, companyId: string, mediaAssetId: string | null): Promise<{ kind: MediaKind; altText: string } | null> {
  if (!mediaAssetId) {
    return null;
  }
  const [asset] = await tx
    .select({ kind: mediaAssets.kind, altText: mediaAssets.altText })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.companyId, companyId), eq(mediaAssets.id, mediaAssetId)));
  return asset ?? null;
}

// generated_version after a change of the draft's image or video alone (an
// attach, taking it off, the library deleting it or changing its alt text):
// the text is untouched, so when it was the AI's it still is, and the AI's
// list of its claims stays current. WHY: a post with an image or a video is
// approved only with its media, so every one the AI wrote would otherwise
// look changed by hand (step 38's "I checked these claims", Regenerate's
// question). Both columns are read as they were before the UPDATE.
export function generatedVersionAfterMediaChange() {
  return sql`CASE WHEN ${contentDrafts.generatedVersion} = ${contentDrafts.version} THEN ${contentDrafts.version} + 1 ELSE ${contentDrafts.generatedVersion} END`;
}

// Why a change of content can't be saved, or null when it can: the person
// is no longer active in the company, the draft's status takes no change
// (archived, or another owner changed it meanwhile), or its version is not
// the one the person saw.
export function refuseContentChange(current: LockedDraft, isActiveMember: boolean, shownVersion: number): DraftChangeOutcome | null {
  if (!isActiveMember) {
    return "not-allowed";
  }
  if (!EDITABLE_STATUSES.includes(current.status)) {
    return "wrong-status";
  }
  return current.version === shownVersion ? null : "stale";
}

// The content columns, each named: never a spread of what was passed in.
export function contentColumns(fields: ContentFields) {
  return {
    title: fields.title,
    body: fields.body,
    hashtags: fields.hashtags,
    callToAction: fields.callToAction,
    imagePrompt: fields.imagePrompt,
    videoScript: fields.videoScript,
  };
}
