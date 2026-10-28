import "server-only";
import { getMediaFileForCompany } from "@/db/media-assets";
import { deletePrivateFile, getPrivateFileAccess, type PrivateFileAccess } from "@/lib/file-storage";
import { EXTENSION_OF_CONTENT_TYPE, type MediaContentType } from "@/lib/media/kinds";
import { describeErrorWithFrames } from "@/lib/safe-error-logging";
import type { SessionContext } from "@/lib/session";
import { mediaAssetIdSchema } from "@/lib/validation/media";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// The media library's files in storage (step 39): where each one goes,
// removing one, and serving one to the session's company through
// /api/media/<id>.
//
// LOGGING RULE for this file: never log a file key or an error message.

// How long a signed link to an image or video works.
const MEDIA_LINK_SECONDS = 5 * 60;

// What /api/media/<id> serves, or why not: null for an unknown asset (or
// another company's, or one whose file is gone), "rate-limited" after too
// many (the route answers 429, never a misleading 404).
export type MediaFile = { access: PrivateFileAccess; contentType: MediaContentType } | "rate-limited" | null;

// Built from ids only, the company first: every company's files stay apart
// in the bucket, and the database's CHECK refuses any other key.
export function mediaStorageKey(companyId: string, assetId: string, contentType: MediaContentType): string {
  return `media/${companyId}/${assetId}.${EXTENSION_OF_CONTENT_TYPE[contentType]}`;
}

// Removes a file whose row is gone (a deleted asset) or was never saved (an
// upload or a generated file whose row couldn't be saved). A failure leaves
// a file nothing points at: logged by class and frames, never shown to
// anyone, and never thrown (the change itself is done).
export async function removeMediaFile(storageKey: string): Promise<void> {
  try {
    await deletePrivateFile(storageKey);
  } catch (error) {
    console.error(`Media file delete failed: ${describeErrorWithFrames(error)}`);
  }
}

// A way to show one of the session company's images or videos: a 5-minute
// signed link (R2), or the bytes (dev).
export async function getMediaFileForSession(session: SessionContext, assetId: unknown): Promise<MediaFile> {
  const parsed = mediaAssetIdSchema.safeParse({ assetId });
  if (!parsed.success) {
    return null;
  }
  if (await isOverRateLimit("media-views", session.userId, RATE_LIMITS.mediaViewsPerUser)) {
    return "rate-limited";
  }
  const file = await getMediaFileForCompany(session.companyId, parsed.data.assetId);
  if (!file) {
    return null;
  }
  const access = await getPrivateFileAccess(file.storageKey, file.contentType, MEDIA_LINK_SECONDS);
  return access ? { access, contentType: file.contentType } : null;
}
