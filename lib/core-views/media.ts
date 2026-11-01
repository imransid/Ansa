import "server-only";
import { callCore, type CoreAnswer } from "@/lib/core-api";
import { toFormErrors } from "@/lib/core-views/auth";
import type { FormResult } from "@/lib/form-result";
import { EMPTY_MEDIA_MESSAGE, MEDIA_TOO_BIG_MESSAGE } from "@/lib/media/files";
import { mediaContentTypes } from "@/lib/media/kinds";
import { MAX_MEDIA_UPLOAD_BYTES } from "@/lib/media/limits";
import type { PrivateFileAccess } from "@/lib/types/file-storage";
import type { MediaAsset } from "@/lib/types/media-assets";
import type { GenerationAvailability, GenerationJobListEntry } from "@/lib/types/media-generation-jobs";
import type { MediaLibraryItem } from "@/lib/types/media-library";
import { mediaAssetIdSchema } from "@/lib/validation/media";

// The media library through the new backend (core's /api/v1/media): the
// page, uploads, a file to show, alt text and deleting, in the shapes the
// page, its actions and the route already read. Asking for images:
// lib/core-views/media-generation.ts.

// A form value as the forms send it: text, or nothing.
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function savedOrErrors(answer: CoreAnswer<unknown>): FormResult {
  return answer.ok ? { ok: true } : { ok: false, errors: toFormErrors(answer) };
}

// Dates come as ISO text.
export type CoreAsset = Omit<MediaAsset, "createdAt"> & { createdAt: string };
type CoreLibraryItem = Omit<MediaLibraryItem, "createdAt"> & { createdAt: string };
type CoreJob = Omit<GenerationJobListEntry, "createdAt" | "finishedAt" | "assetDeletedAt"> & {
  createdAt: string;
  finishedAt: string | null;
  assetDeletedAt: string | null;
};

export function toMediaAsset(asset: CoreAsset): MediaAsset {
  return { ...asset, createdAt: new Date(asset.createdAt) };
}

function toJob(job: CoreJob): GenerationJobListEntry {
  return {
    ...job,
    createdAt: new Date(job.createdAt),
    finishedAt: job.finishedAt ? new Date(job.finishedAt) : null,
    assetDeletedAt: job.assetDeletedAt ? new Date(job.assetDeletedAt) : null,
  };
}

export type MediaPage = {
  assets: MediaLibraryItem[];
  totals: { count: number; totalBytes: number };
  jobs: GenerationJobListEntry[];
  generation: GenerationAvailability;
};

// One page of the library (50, newest first, each with the drafts using
// it), its totals, the newest 20 requests, and whether images can be made.
export async function getMediaPageFromCore(page: number): Promise<MediaPage> {
  const answer = await callCore<{ assets: CoreLibraryItem[]; totals: MediaPage["totals"]; jobs: CoreJob[]; generation: GenerationAvailability }>(
    "GET",
    `/api/v1/media?page=${page}`,
  );
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  const { assets, totals, jobs, generation } = answer.data;
  return {
    assets: assets.map((asset) => ({ ...asset, createdAt: new Date(asset.createdAt) })),
    totals,
    jobs: jobs.map(toJob),
    generation: { available: generation.available, isStandIn: generation.isStandIn, makesVideo: generation.makesVideo },
  };
}

// An asset's address in core, or null when the id (a claim from the
// address or a form) isn't a uuid: then it is no asset.
function assetPath(assetId: unknown): string | null {
  const parsed = mediaAssetIdSchema.safeParse({ assetId });
  return parsed.success ? `/api/v1/media/${parsed.data.assetId}` : null;
}

const UNKNOWN_IMAGE: FormResult = { ok: false, errors: { message: "Unknown image. Reload the page." } };

// Stores one uploaded image or video. The file goes as base64; core checks
// its name, size and first bytes.
export async function uploadMediaThroughCore(file: unknown, altText: unknown): Promise<FormResult> {
  if (!(file instanceof File)) {
    return { ok: false, errors: { message: EMPTY_MEDIA_MESSAGE } };
  }
  // WHY here: a bigger file, as base64, passes core's body limit and would
  // get a bare refusal instead of these words (the form checks it first too).
  if (file.size > MAX_MEDIA_UPLOAD_BYTES) {
    return { ok: false, errors: { message: MEDIA_TOO_BIG_MESSAGE } };
  }
  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  return savedOrErrors(await callCore("POST", "/api/v1/media", { fileName: file.name, data, altText: text(altText) }));
}

// What a picture shows: every draft using it gets it as its next version.
export async function saveAltTextThroughCore(assetId: unknown, altText: unknown): Promise<FormResult> {
  const path = assetPath(assetId);
  return path ? savedOrErrors(await callCore("POST", `${path}/alt-text`, { altText: text(altText) })) : UNKNOWN_IMAGE;
}

// Refused while a draft that is approved, scheduled, published or failed uses it.
export async function deleteMediaThroughCore(assetId: unknown): Promise<FormResult> {
  const path = assetPath(assetId);
  return path ? savedOrErrors(await callCore("POST", `${path}/delete`, {})) : UNKNOWN_IMAGE;
}

// What /api/media/<id> serves: a 5-minute signed link, or (development) the
// bytes with the type stored. "rate-limited" after too many, null when the
// company has no such file.
export type MediaFileFromCore = { access: PrivateFileAccess; contentType: string } | "rate-limited" | null;

export async function getMediaFileFromCore(assetId: string): Promise<MediaFileFromCore> {
  const path = assetPath(assetId);
  if (!path) {
    return null;
  }
  const answer = await callCore<{ url: string } | { contentType: string; data: string }>("GET", `${path}/file`);
  if (!answer.ok) {
    if (answer.status === 429) {
      return "rate-limited";
    }
    if (answer.status === 404) {
      return null;
    }
    throw new Error(`Core answered ${answer.status}`);
  }
  if ("url" in answer.data) {
    // The signed link carries the stored type itself.
    return { access: { kind: "signed-url", url: answer.data.url }, contentType: "" };
  }
  const { contentType, data } = answer.data;
  // Only the types the library stores are ever shown inline (never, say, HTML).
  if (!(mediaContentTypes as readonly string[]).includes(contentType)) {
    return null;
  }
  return { access: { kind: "bytes", bytes: Buffer.from(data, "base64"), contentType }, contentType };
}
