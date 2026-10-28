import "server-only";
import { randomUUID } from "node:crypto";
import { updateMediaAltText } from "@/db/media-alt-text";
import {
  getDraftsUsingMedia,
  getLibraryPositionsOfAssets,
  getMediaAssetsForCompany,
  getMediaTotalsForCompany,
  insertUploadedMediaAsset,
  type DraftUsingMedia,
  type MediaAssetListItem,
} from "@/db/media-assets";
import { countOpenGenerationJobs } from "@/db/media-generation-jobs";
import { putPrivateFile } from "@/lib/file-storage";
import type { FormResult } from "@/lib/form-result";
import { readImageSize } from "@/lib/media/dimensions";
import { checkMediaFile, EMPTY_MEDIA_MESSAGE } from "@/lib/media/files";
import { MAX_MEDIA_ASSETS_PER_COMPANY, MAX_MEDIA_STORAGE_BYTES_PER_COMPANY, MEDIA_ORIGINAL_NAME_MAX_LENGTH } from "@/lib/media/limits";
import { PAGE_SIZE } from "@/lib/pagination";
import { toPlainSingleLine } from "@/lib/plain-text";
import { describeErrorWithFrames } from "@/lib/safe-error-logging";
import type { SessionContext } from "@/lib/session";
import { altTextSchema, mediaAltTextSchema } from "@/lib/validation/media";
import { draftsUsing } from "./media-deletion";
import { mediaStorageKey, removeMediaFile } from "./media-files";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// The Co-Founder's media library (step 39): the list, uploads and alt
// text. Everyone in the company uses it, as they use the studio. Deleting:
// services/media-deletion.ts; serving the files: services/media-files.ts;
// images and videos made by an image service: services/media-generation-jobs.ts.
//
// LOGGING RULE for this file: never log a file name, a file key, alt text
// or an error message (a storage error can quote the key).

export type { DraftUsingMedia };

export type MediaLibraryItem = MediaAssetListItem & { usedBy: DraftUsingMedia[] };

export const MEDIA_LIBRARY_FULL_MESSAGE = "Your media library is full (300 files or 500 MB in all). Delete something to make room.";

// One page of the session company's assets, newest first, each with the drafts using it.
export async function listMediaForSession(session: SessionContext, page: number): Promise<MediaLibraryItem[]> {
  const assets = await getMediaAssetsForCompany(session.companyId, page);
  const usedBy = await getDraftsUsingMedia(session.companyId, assets.map((asset) => asset.id));
  return assets.map((asset) => ({ ...asset, usedBy: usedBy.filter((draft) => draft.assetId === asset.id) }));
}

// How many assets the session's company keeps, and their bytes together.
export async function getMediaTotalsForSession(session: SessionContext): Promise<{ count: number; totalBytes: number }> {
  return getMediaTotalsForCompany(session.companyId);
}

// True when one more file of this size would take the company past its
// cap. Two at the same moment can both pass, going over by a file or two
// (each is rate limited): fine for a cost cap, nobody gets data.
export async function wouldPassMediaCap(companyId: string, fileSize: number): Promise<boolean> {
  const stored = await getMediaTotalsForCompany(companyId);
  return stored.count >= MAX_MEDIA_ASSETS_PER_COMPANY || stored.totalBytes + fileSize > MAX_MEDIA_STORAGE_BYTES_PER_COMPANY;
}

// True when the files stored and the requests still waiting or being made
// (each will be a file) fill the company's library: a new request is then
// refused before the image service is asked (and paid). Its size is only
// known once it is made: saving it checks the bytes again, under the
// company's lock (db/media-generation-runs.ts).
export async function isMediaLibraryFullForRequests(companyId: string): Promise<boolean> {
  const [stored, coming] = await Promise.all([getMediaTotalsForCompany(companyId), countOpenGenerationJobs(companyId)]);
  return stored.count + coming >= MAX_MEDIA_ASSETS_PER_COMPANY || stored.totalBytes >= MAX_MEDIA_STORAGE_BYTES_PER_COMPANY;
}

// The page of the company's library (50 to a page, newest first) that shows
// each of these assets, for links to its card. Unknown ids are left out.
export async function getLibraryPagesOfAssets(companyId: string, assetIds: string[]): Promise<Map<string, number>> {
  const positions = await getLibraryPositionsOfAssets(companyId, assetIds);
  return new Map([...positions].map(([assetId, position]) => [assetId, Math.ceil(position / PAGE_SIZE)]));
}

// Stores an uploaded image or video of the session's company in private
// storage, after the same checks the upload form makes in the browser
// (name, size and the file's own first bytes), then records it.
export async function uploadMediaForSession(session: SessionContext, input: { file: unknown; altText: unknown }): Promise<FormResult> {
  if (!(input.file instanceof File)) {
    return refused(EMPTY_MEDIA_MESSAGE);
  }
  const altText = altTextSchema.safeParse(input.altText);
  if (!altText.success) {
    return { ok: false, errors: { fieldErrors: { altText: altText.error.issues.map((issue) => issue.message) } } };
  }
  const file = input.file;
  const bytes = Buffer.from(await file.arrayBuffer());
  const checked = checkMediaFile({ name: file.name, size: bytes.length }, bytes);
  if (!checked.ok) {
    return refused(checked.message);
  }
  if (await isOverRateLimit("media-uploads", session.userId, RATE_LIMITS.mediaUploadsPerUser)) {
    return refused("Too many uploads. Try again in a few minutes.");
  }
  if (await wouldPassMediaCap(session.companyId, bytes.length)) {
    return refused(MEDIA_LIBRARY_FULL_MESSAGE);
  }
  const assetId = randomUUID();
  const storageKey = mediaStorageKey(session.companyId, assetId, checked.contentType);
  // Storage being down is a failure we expect now and then: a message on
  // the page, not an error screen.
  try {
    await putPrivateFile(storageKey, bytes, checked.contentType);
  } catch (error) {
    console.error(`Media storage failed: ${describeErrorWithFrames(error)}`);
    return refused("The file could not be stored right now, so nothing was saved. Try again in a few minutes.");
  }
  const size = readImageSize(bytes, checked.contentType);
  const saved = await saveUploadOrRemoveFile(session, storageKey, {
    id: assetId,
    kind: checked.kind,
    contentType: checked.contentType,
    sizeBytes: bytes.length,
    width: size?.width ?? null,
    height: size?.height ?? null,
    storageKey,
    originalName: shownFileName(file.name, checked.extension),
    altText: altText.data,
  });
  return saved === "saved" ? { ok: true } : refused("You can't add media to this company.");
}

// Saves what one of the session company's pictures shows. The drafts using
// it get it as their next version (an approved one loses its approval);
// one scheduled, published or failed to publish keeps the old text.
export async function saveMediaAltTextForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = mediaAltTextSchema.safeParse(input);
  if (!parsed.success) {
    const altTextProblem = parsed.error.issues.find((issue) => issue.path[0] === "altText");
    return altTextProblem ? { ok: false, errors: { fieldErrors: { altText: [altTextProblem.message] } } } : refused("Unknown image. Reload the page.");
  }
  if (await isOverRateLimit("media-changes", session.userId, RATE_LIMITS.mediaChangesPerUser)) {
    return refused("Too many changes. Try again in a few minutes.");
  }
  const saved = await updateMediaAltText(session.companyId, session.userId, parsed.data);
  switch (saved.outcome) {
    case "changed":
    case "unchanged":
      return { ok: true };
    case "in-use":
      return refused(`It can't be changed while ${draftsUsing(saved.drafts)} it: a draft that is scheduled, published or failed to publish keeps the alt text it was approved with.`);
    case "not-found":
      return refused("We couldn't find that image or video. Reload the page.");
    case "not-allowed":
      return refused("You can't change media of this company.");
  }
}

// Records an upload whose file is stored. If the row can't be saved, nobody
// could ever reach or delete the file, so it is removed (best effort).
async function saveUploadOrRemoveFile(
  session: SessionContext,
  storageKey: string,
  asset: Parameters<typeof insertUploadedMediaAsset>[2],
): Promise<"saved" | "not-allowed"> {
  try {
    const saved = await insertUploadedMediaAsset(session.companyId, session.userId, asset);
    if (saved === "not-allowed") {
      await removeMediaFile(storageKey);
    }
    return saved;
  } catch (error) {
    await removeMediaFile(storageKey);
    throw error;
  }
}

// The name shown in the list: one plain line (a right-to-left override
// can't disguise it), at most 200 characters, whole characters only.
function shownFileName(name: string, extension: string): string {
  const plain = [...toPlainSingleLine(name)].slice(0, MEDIA_ORIGINAL_NAME_MAX_LENGTH).join("").trim();
  return plain || `file.${extension}`;
}

// A refusal with this message.
function refused(message: string): FormResult & { ok: false } {
  return { ok: false, errors: { message } };
}
