import "server-only";
import { setDraftMedia } from "@/db/content-draft-media";
import { getMediaAssetForCompany, getMediaChoicesForCompany, type MediaAsset } from "@/db/media-assets";
import { getNewestGenerationJobAtVersion, getOpenGenerationJobForDraft } from "@/db/media-generation-jobs";
import { mediaKindOfFormat } from "@/lib/content-studio/draft-fields";
import type { ContentFormat } from "@/lib/content-studio/formats";
import type { FormResult } from "@/lib/form-result";
import type { MediaGenerationJobStatus } from "@/lib/media/kinds";
import { MEDIA_CHOICES_SHOWN } from "@/lib/media/limits";
import type { SessionContext } from "@/lib/session";
import { draftMediaSchema } from "@/lib/validation/media";
import { describeDraftOutcome, tooManyDraftChanges } from "./content-draft-messages";
import { describeGenerationAvailability } from "./media-generation-jobs";
import { getLibraryPagesOfAssets } from "./media-library";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// A content draft's image or video (step 39): attaching one from the media
// library or taking it off (anyone in the company, like an edit: the next
// version, without any approval), and what the draft's page shows about it.

export type { MediaAsset };

export type DraftMediaPanel = {
  // What the draft's format attaches (null: a text post takes none).
  kind: "image" | "video" | null;
  attached: MediaAsset | null;
  // The page of the media library that shows the attached one (its alt text is edited there).
  attachedLibraryPage: number | null;
  // The company's newest of that kind, to pick from.
  choices: MediaAsset[];
  // The request made from this draft still waiting or being made.
  // forThisVersion: asked at the version on screen, so what it makes is
  // attached as the next version (the editor waits for it); otherwise the
  // draft changed since, and it only goes to the library.
  openJob: { id: string; status: MediaGenerationJobStatus; createdAt: Date; isStuck: boolean; forThisVersion: boolean } | null;
  // The newest request made at the version on screen, when it failed: its code (lib/media/error-codes.ts).
  lastFailure: { code: string } | null;
  // Whether "Make the image with the AI" can ask anyone, and whether that is the stand-in.
  generation: { available: boolean; isStandIn: boolean };
};

// Attaches one of the session company's assets to one of its drafts, or
// takes it off (assetId ""), as the version the page showed.
export async function setDraftMediaForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = draftMediaSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "Unknown draft or image. Reload the page and try again." } };
  }
  if (await isOverRateLimit("content-draft-changes", session.userId, RATE_LIMITS.contentDraftChangesPerUser)) {
    return tooManyDraftChanges();
  }
  const outcome = await setDraftMedia(session.companyId, session.userId, parsed.data);
  if (outcome === "wrong-kind") {
    return { ok: false, errors: { message: "A post with an image takes an image, and a video a video; a text post takes neither." } };
  }
  if (outcome === "media-not-found") {
    return { ok: false, errors: { message: "We couldn't find that image or video: it may have been deleted. Reload the page." } };
  }
  return describeDraftOutcome(outcome);
}

// What one draft of the session's company shows under Media, at its version on screen.
export async function getDraftMediaPanelForSession(
  session: SessionContext,
  draft: { id: string; format: ContentFormat; mediaAssetId: string | null; version: number },
): Promise<DraftMediaPanel> {
  const kind = mediaKindOfFormat(draft.format);
  // Only a post with an image gets its image made from the draft.
  const availability = describeGenerationAvailability();
  const generation = { available: availability.available && kind === "image", isStandIn: availability.isStandIn };
  if (!kind) {
    return { kind, attached: null, attachedLibraryPage: null, choices: [], openJob: null, lastFailure: null, generation };
  }
  const [attached, choices, openJob, newestAtVersion, pages] = await Promise.all([
    draft.mediaAssetId ? getMediaAssetForCompany(session.companyId, draft.mediaAssetId) : undefined,
    getMediaChoicesForCompany(session.companyId, kind, MEDIA_CHOICES_SHOWN),
    getOpenGenerationJobForDraft(session.companyId, draft.id),
    getNewestGenerationJobAtVersion(session.companyId, draft.id, draft.version),
    getLibraryPagesOfAssets(session.companyId, draft.mediaAssetId ? [draft.mediaAssetId] : []),
  ]);
  return {
    kind,
    attached: attached ?? null,
    attachedLibraryPage: draft.mediaAssetId ? (pages.get(draft.mediaAssetId) ?? null) : null,
    choices,
    openJob: openJob
      ? { id: openJob.id, status: openJob.status, createdAt: openJob.createdAt, isStuck: openJob.isStuck, forThisVersion: openJob.draftVersion === draft.version }
      : null,
    lastFailure: newestAtVersion?.status === "failed" && newestAtVersion.lastError ? { code: newestAtVersion.lastError } : null,
    generation,
  };
}
