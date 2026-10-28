import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { EDITABLE_STATUSES, mediaKindOfFormat, statusAfterContentChange, type ContentFields } from "@/lib/content-studio/draft-fields";
import type { ContentDraftStatus } from "@/lib/content-studio/formats";
import type { MediaKind } from "@/lib/media/kinds";
import { db, type DbTransaction } from "./client";
import { contentColumns, generatedVersionAfterMediaChange, lockDraft, NO_APPROVAL, refuseContentChange, type LockedDraft } from "./content-draft-rows";
import type { DraftChangeOutcome } from "./content-draft-writes";
import { lockActiveAuthorRole } from "./knowledge-author";
import { cancelQueuedJobsAfterChange } from "./publish-draft-sync";
import { contentDrafts, mediaAssets } from "./schema";

// The image or video of one company's content draft (step 39): a person
// attaching one from the media library or taking it off, a finished
// generation attaching its result to the draft it was asked for, and the
// library deleting the file or changing its alt text (which is published
// with it). Each is a change of content: the next version, without any
// approval, in the same UPDATE, exactly like an edit
// (db/content-draft-writes.ts), but not of the text (generated_version
// comes along, db/content-draft-rows.ts). Its waiting posts are canceled
// in the same transaction (step 41, db/publish-draft-sync.ts).

// "wrong-kind": an image for a video (or the other way round), or anything
// for a text post. "media-not-found": not an asset of this company.
export type SetDraftMediaOutcome = DraftChangeOutcome | "wrong-kind" | "media-not-found";

// A draft using one asset, as the media library's changes decide on it.
export type DraftUsingAsset = ContentFields & { id: string; topic: string; status: ContentDraftStatus; approvedByUserId: string | null };

// Attaches one asset of one company to one of its drafts (assetId null:
// takes it off), as the version the person saw. Lock order: the person,
// then the asset (FOR KEY SHARE: it can't be deleted meanwhile, see
// db/media-asset-deletion.ts), then the draft.
export async function setDraftMedia(
  companyId: string,
  actorUserId: string,
  change: { draftId: string; version: number; assetId: string | null },
): Promise<SetDraftMediaOutcome> {
  return db.transaction(async (tx) => {
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    const asset = change.assetId ? await lockAssetToAttach(tx, companyId, change.assetId) : null;
    if (change.assetId && !asset) {
      return "media-not-found";
    }
    const draft = await lockDraft(tx, companyId, change.draftId);
    if (!draft) {
      return "not-found";
    }
    const refusal = refuseContentChange(draft, role !== null, change.version);
    if (refusal) {
      return refusal;
    }
    if (draft.mediaAssetId === change.assetId) {
      return "unchanged";
    }
    if (asset && mediaKindOfFormat(draft.format) !== asset.kind) {
      return "wrong-kind";
    }
    await writeDraftMedia(tx, companyId, actorUserId, { draftId: change.draftId, draft, assetId: change.assetId });
    return "changed";
  });
}

// Attaches a just-made asset to the draft its job was asked for, inside the
// transaction that saves the asset (db/media-generation-runs.ts). Only when
// the draft still takes it: editable (an archived one isn't), of the format
// that takes this kind, and still at the version the request was made at.
// WHY the version: a request that was stuck, run hours later, must never
// replace what was attached, edited or approved since. The asset is kept
// in the library either way.
export async function attachGeneratedMedia(
  tx: DbTransaction,
  companyId: string,
  actorUserId: string,
  target: { draftId: string; draft: LockedDraft; askedAtVersion: number; assetId: string; kind: MediaKind },
): Promise<"attached" | "not-attached"> {
  const { draft } = target;
  const takesIt = EDITABLE_STATUSES.includes(draft.status) && mediaKindOfFormat(draft.format) === target.kind;
  if (!takesIt || draft.version !== target.askedAtVersion) {
    return "not-attached";
  }
  await writeDraftMedia(tx, companyId, actorUserId, { draftId: target.draftId, draft, assetId: target.assetId });
  return "attached";
}

// Every draft of one company using one asset, locked FOR UPDATE until the
// transaction ends: the media library's delete and alt text change lock
// them all before changing anything, so an approval or an attach of that
// asset waits for them, or they for it.
export async function lockDraftsUsingAsset(tx: DbTransaction, companyId: string, assetId: string): Promise<DraftUsingAsset[]> {
  return tx
    .select({
      id: contentDrafts.id,
      topic: contentDrafts.topic,
      status: contentDrafts.status,
      title: contentDrafts.title,
      body: contentDrafts.body,
      hashtags: contentDrafts.hashtags,
      callToAction: contentDrafts.callToAction,
      imagePrompt: contentDrafts.imagePrompt,
      videoScript: contentDrafts.videoScript,
      approvedByUserId: contentDrafts.approvedByUserId,
    })
    .from(contentDrafts)
    .where(and(eq(contentDrafts.companyId, companyId), eq(contentDrafts.mediaAssetId, assetId)))
    .for("update");
}

// The UPDATE every change of a draft's media shares: the media (assetId:
// what it has now; null: none), the next version, no approval, and who
// changed it. A draft with nothing written gets "draft" once something is
// attached, and "idea" again once it is taken off; an archived one stays
// archived (only the media library changes one). An approval taken away,
// or waiting posts canceled, is recorded.
export async function writeDraftMedia(
  tx: DbTransaction,
  companyId: string,
  actorUserId: string,
  target: { draftId: string; draft: ContentFields & { status: ContentDraftStatus; approvedByUserId: string | null }; assetId: string | null },
): Promise<void> {
  const status = target.draft.status === "archived" ? "archived" : statusAfterContentChange(contentColumns(target.draft), target.assetId !== null);
  await tx
    .update(contentDrafts)
    .set({
      mediaAssetId: target.assetId,
      status,
      version: sql`${contentDrafts.version} + 1`,
      generatedVersion: generatedVersionAfterMediaChange(),
      ...NO_APPROVAL,
      updatedByUserId: actorUserId,
      updatedAt: sql`now()`,
    })
    .where(and(eq(contentDrafts.companyId, companyId), eq(contentDrafts.id, target.draftId)));
  await cancelQueuedJobsAfterChange(tx, companyId, actorUserId, { id: target.draftId, approvedByUserId: target.draft.approvedByUserId });
}

// One asset of one company, locked FOR KEY SHARE until the transaction ends.
async function lockAssetToAttach(tx: DbTransaction, companyId: string, assetId: string): Promise<{ kind: MediaKind } | undefined> {
  const [asset] = await tx
    .select({ kind: mediaAssets.kind })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.companyId, companyId), eq(mediaAssets.id, assetId)))
    .for("key share");
  return asset;
}
