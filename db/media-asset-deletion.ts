import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { STATUSES_KEEPING_MEDIA } from "@/lib/content-studio/draft-fields";
import type { ContentDraftStatus } from "@/lib/content-studio/formats";
import { db } from "./client";
import { lockDraftsUsingAsset, writeDraftMedia } from "./content-draft-media";
import { lockActiveAuthorRole } from "./knowledge-author";
import { mediaAssets, mediaGenerationJobs } from "./schema";

// Deleting one asset of one company's media library (step 39). Anyone
// active in the company, as for drafts: nothing published depends on it,
// because an asset an approved, scheduled, published or failed draft uses
// is never deleted.

export type DraftKeepingMedia = { draftId: string; topic: string; status: ContentDraftStatus };

export type DeleteMediaOutcome =
  | { outcome: "deleted"; storageKey: string }
  | { outcome: "in-use"; drafts: DraftKeepingMedia[] }
  | { outcome: "not-found" }
  | { outcome: "not-allowed" };

// Deletes the asset's row in ONE transaction: the drafts that may lose it
// (ideas can't have one; drafts, rejected and archived ones) lose it as a
// change of content (their next version), and the job that made it keeps
// its history (succeeded, its asset deleted since). Returns the storage key,
// so the caller removes the file once the row is gone. Lock order: the
// person, the asset, then EVERY draft using it, before anything is changed:
// an approval or an attach of that asset waits for this, or this for them.
export async function deleteMediaAsset(companyId: string, actorUserId: string, assetId: string): Promise<DeleteMediaOutcome> {
  return db.transaction(async (tx) => {
    if (!(await lockActiveAuthorRole(tx, companyId, actorUserId))) {
      return { outcome: "not-allowed" };
    }
    const [asset] = await tx
      .select({ storageKey: mediaAssets.storageKey })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.companyId, companyId), eq(mediaAssets.id, assetId)))
      .for("update");
    if (!asset) {
      return { outcome: "not-found" };
    }
    const drafts = await lockDraftsUsingAsset(tx, companyId, assetId);
    const keeping = drafts.filter((draft) => STATUSES_KEEPING_MEDIA.includes(draft.status));
    if (keeping.length > 0) {
      return { outcome: "in-use", drafts: keeping.map((draft) => ({ draftId: draft.id, topic: draft.topic, status: draft.status })) };
    }
    // An archived draft stays archived; any other becomes a draft again (an
    // idea when nothing is written).
    for (const draft of drafts) {
      await writeDraftMedia(tx, companyId, actorUserId, { draftId: draft.id, draft, assetId: null });
    }
    await tx
      .update(mediaGenerationJobs)
      .set({ assetId: null, assetDeletedAt: sql`now()` })
      .where(and(eq(mediaGenerationJobs.companyId, companyId), eq(mediaGenerationJobs.assetId, assetId)));
    await tx.delete(mediaAssets).where(and(eq(mediaAssets.companyId, companyId), eq(mediaAssets.id, assetId)));
    return { outcome: "deleted", storageKey: asset.storageKey };
  });
}
