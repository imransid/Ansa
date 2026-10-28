import "server-only";
import { and, eq } from "drizzle-orm";
import { STATUSES_KEEPING_ALT_TEXT } from "@/lib/content-studio/draft-fields";
import { db } from "./client";
import { lockDraftsUsingAsset, writeDraftMedia } from "./content-draft-media";
import type { DraftKeepingMedia } from "./media-asset-deletion";
import { lockActiveAuthorRole } from "./knowledge-author";
import { mediaAssets } from "./schema";

// What one image or video of one company's media library shows, for people
// who can't see it (step 39). It is published with the file (step 41), so
// it is part of every draft using it: changing it is a change of content of
// each of them, like an edit, and an approved draft is never published with
// words its owner didn't see. Anyone active in the company, as for drafts.

export type AltTextOutcome =
  | { outcome: "changed" | "unchanged" | "not-found" | "not-allowed" }
  // A draft that is scheduled, published or failed to publish uses it.
  | { outcome: "in-use"; drafts: DraftKeepingMedia[] };

// Saves one asset's alt text in ONE transaction: every draft using it gets
// it as its next version, without its approval (an approved one becomes a
// draft again, an archived one stays archived), or nothing changes while a
// draft that is scheduled, published or failed to publish uses it. Lock
// order, as a delete: the person, the asset, then EVERY draft using it,
// before anything is changed, so an approval at the same moment either
// sees the new text or is refused as stale (db/content-draft-status.ts).
export async function updateMediaAltText(companyId: string, actorUserId: string, change: { assetId: string; altText: string }): Promise<AltTextOutcome> {
  return db.transaction(async (tx) => {
    if (!(await lockActiveAuthorRole(tx, companyId, actorUserId))) {
      return { outcome: "not-allowed" };
    }
    // "No key update": attaching the asset to a draft at this moment (which
    // only needs it to exist) doesn't wait for this; a delete does.
    const [asset] = await tx
      .select({ altText: mediaAssets.altText })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.companyId, companyId), eq(mediaAssets.id, change.assetId)))
      .for("no key update");
    if (!asset) {
      return { outcome: "not-found" };
    }
    if (asset.altText === change.altText) {
      return { outcome: "unchanged" };
    }
    const drafts = await lockDraftsUsingAsset(tx, companyId, change.assetId);
    const keeping = drafts.filter((draft) => STATUSES_KEEPING_ALT_TEXT.includes(draft.status));
    if (keeping.length > 0) {
      return { outcome: "in-use", drafts: keeping.map((draft) => ({ draftId: draft.id, topic: draft.topic, status: draft.status })) };
    }
    for (const draft of drafts) {
      await writeDraftMedia(tx, companyId, actorUserId, { draftId: draft.id, draft, assetId: change.assetId });
    }
    await tx
      .update(mediaAssets)
      .set({ altText: change.altText })
      .where(and(eq(mediaAssets.companyId, companyId), eq(mediaAssets.id, change.assetId)));
    return { outcome: "changed" };
  });
}
