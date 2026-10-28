// What the Co-Founder's media library holds (step 39): its kinds, where an
// asset came from, the only file types stored, and the statuses of an
// image or video being made, with the words the pages use. A file of its
// own with no imports, so the forms in the browser, lib/env.ts and the
// database schema (db/schema/media.ts, whose CHECKs list the same values; a
// check proves they agree) read one list.

export const mediaKinds = ["image", "video"] as const;
export type MediaKind = (typeof mediaKinds)[number];

export const MEDIA_KIND_LABELS: Record<MediaKind, string> = { image: "Image", video: "Video" };

// Uploaded by a person, or made by an image service from a prompt.
export const mediaSources = ["upload", "generated"] as const;
export type MediaSource = (typeof mediaSources)[number];

// The only types stored and served. Never SVG: an SVG file can carry
// scripts. The type comes from the file's own first bytes
// (lib/media/signatures.ts), never from the browser or the file's name.
export const mediaContentTypes = ["image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4"] as const;
export type MediaContentType = (typeof mediaContentTypes)[number];

export const KIND_OF_CONTENT_TYPE: Record<MediaContentType, MediaKind> = {
  "image/png": "image",
  "image/jpeg": "image",
  "image/webp": "image",
  "image/gif": "image",
  "video/mp4": "video",
};

// The extension a stored file gets: media/<companyId>/<assetId>.<extension>.
export const EXTENSION_OF_CONTENT_TYPE: Record<MediaContentType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
};

export const CONTENT_TYPE_LABELS: Record<MediaContentType, string> = {
  "image/png": "PNG image",
  "image/jpeg": "JPEG image",
  "image/webp": "WebP image",
  "image/gif": "GIF image",
  "video/mp4": "MP4 video",
};

// An image or video being made: waiting to start, being made (claimed by
// one run), and how it ended. Only a waiting one can be canceled.
export const mediaGenerationJobStatuses = ["queued", "running", "succeeded", "failed", "canceled"] as const;
export type MediaGenerationJobStatus = (typeof mediaGenerationJobStatuses)[number];

export const JOB_STATUS_LABELS: Record<MediaGenerationJobStatus, string> = {
  queued: "Waiting to start",
  running: "Being made",
  succeeded: "Done",
  failed: "Failed",
  canceled: "Canceled",
};

// The values MEDIA_PROVIDER may have (lib/env.ts), one per adapter
// (lib/media-generation.ts). Only the development stand-in exists: a real
// image or video service is not chosen yet (IMPLEMENTATION_PLAN.md,
// decision 9).
export const mediaProviderNames = ["dev-stand-in"] as const;
export type MediaProviderName = (typeof mediaProviderNames)[number];

// The provider name the development stand-in records on its jobs and assets.
export const DEV_STAND_IN_PROVIDER: MediaProviderName = "dev-stand-in";
