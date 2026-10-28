import "server-only";
import { deleteMediaAsset, type DraftKeepingMedia } from "@/db/media-asset-deletion";
import { CONTENT_STATUS_LABELS } from "@/lib/content-studio/formats";
import type { FormResult } from "@/lib/form-result";
import type { SessionContext } from "@/lib/session";
import { mediaAssetIdSchema } from "@/lib/validation/media";
import { removeMediaFile } from "./media-files";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Deleting an image or video of the media library (step 39). Anyone in the
// company, as for drafts: an asset a draft that is approved, scheduled,
// published or failed to publish uses is never deleted, and every other
// draft using it loses it as its next version (db/media-asset-deletion.ts).
//
// LOGGING RULE for this file: never log a file key or an error message.

// Deletes one of the session company's assets, or says which drafts keep
// it. WHY the row goes first and the file after (documents do it the other
// way round): the row's transaction is where the draft rules decide, and a
// file removed first would be gone even when they then keep the asset for
// an approved draft.
export async function deleteMediaForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = mediaAssetIdSchema.safeParse(input);
  if (!parsed.success) {
    return refused("Unknown image. Reload the page.");
  }
  if (await isOverRateLimit("media-changes", session.userId, RATE_LIMITS.mediaChangesPerUser)) {
    return refused("Too many changes. Try again in a few minutes.");
  }
  const deleted = await deleteMediaAsset(session.companyId, session.userId, parsed.data.assetId);
  switch (deleted.outcome) {
    case "deleted":
      await removeMediaFile(deleted.storageKey);
      return { ok: true };
    case "in-use":
      return refused(describeDraftsKeepingMedia(deleted.drafts));
    case "not-found":
      return refused("We couldn't find that image or video: it may be deleted already. Reload the page.");
    case "not-allowed":
      return refused("You can't change media of this company.");
  }
}

// "the draft “Lunch menu” (Approved) uses", or "the drafts “A” (Approved),
// “B” (Scheduled), “C” (Published) and 2 more use": the media library's
// refusals name the drafts they are about (alt text too, services/media-library.ts).
export function draftsUsing(drafts: DraftKeepingMedia[]): string {
  const named = drafts.slice(0, 3).map((draft) => `“${draft.topic}” (${CONTENT_STATUS_LABELS[draft.status]})`);
  const more = drafts.length > 3 ? ` and ${drafts.length - 3} more` : "";
  return drafts.length === 1 ? `the draft ${named[0]} uses` : `the drafts ${named.join(", ")}${more} use`;
}

// "It can't be deleted while the draft “Lunch menu” (Approved) uses it: ..."
function describeDraftsKeepingMedia(drafts: DraftKeepingMedia[]): string {
  const rule = `It can't be deleted while ${draftsUsing(drafts)} it: a draft that is approved, scheduled, published or failed to publish keeps its image or video.`;
  const allApproved = drafts.every((draft) => draft.status === "approved");
  return allApproved ? `${rule} Take it off the draft first, or archive the draft (either takes the approval away).` : rule;
}

// A refusal with this message.
function refused(message: string): FormResult & { ok: false } {
  return { ok: false, errors: { message } };
}
