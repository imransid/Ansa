import { EXTENSION_OF_CONTENT_TYPE, KIND_OF_CONTENT_TYPE, type MediaContentType, type MediaKind } from "./kinds";
import { MAX_MEDIA_UPLOAD_BYTES } from "./limits";
import { detectMediaType } from "./signatures";

// Which files the media library accepts (step 39). Shared by the upload form
// in the browser and by services/media-library.ts, so both refuse the same
// files with the same words. No server-only code here.

// The type each accepted name ending promises. The file's first bytes must
// then be that type (lib/media/signatures.ts): a PNG named .jpg, or a script
// named .png, is refused.
const TYPE_OF_EXTENSION: Record<string, MediaContentType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
};

// For the file picker's accept attribute: ".png,.jpg,...".
export const MEDIA_EXTENSIONS_FOR_PICKER = Object.keys(TYPE_OF_EXTENSION)
  .map((extension) => `.${extension}`)
  .join(",");

export const EMPTY_MEDIA_MESSAGE = "Choose an image or a video to upload.";
export const WRONG_MEDIA_TYPE_MESSAGE = "Upload a PNG, JPEG, WebP or GIF image, or an MP4 video.";
export const SVG_MEDIA_MESSAGE = "SVG images can't be uploaded: they can carry scripts. Save it as a PNG and upload that.";
export const MEDIA_TOO_BIG_MESSAGE = "Files can be at most 4 MB.";
export const NOT_MEDIA_MESSAGE = "This file isn't a PNG, JPEG, WebP, GIF or MP4 file, whatever its name says.";

// "This file is a PNG image": each type as the refusal names it.
const WHAT_THE_FILE_IS: Record<MediaContentType, string> = {
  "image/png": "a PNG image",
  "image/jpeg": "a JPEG image",
  "image/webp": "a WebP image",
  "image/gif": "a GIF image",
  "video/mp4": "an MP4 video",
};

export type MediaFileCheck =
  | { ok: true; contentType: MediaContentType; kind: MediaKind; extension: string }
  | { ok: false; message: string };

// Says whether this file can be uploaded, from its name, its size and its
// first bytes (at least SIGNATURE_BYTES of them): the type stored for it
// and its kind, or why not, in the words the page shows.
export function checkMediaFile(file: { name: string; size: number }, firstBytes: Uint8Array): MediaFileCheck {
  if (file.size === 0) {
    return { ok: false, message: EMPTY_MEDIA_MESSAGE };
  }
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? "";
  if (extension === "svg" || extension === "svgz") {
    return { ok: false, message: SVG_MEDIA_MESSAGE };
  }
  const promised = Object.hasOwn(TYPE_OF_EXTENSION, extension) ? TYPE_OF_EXTENSION[extension] : undefined;
  if (!promised) {
    return { ok: false, message: WRONG_MEDIA_TYPE_MESSAGE };
  }
  if (file.size > MAX_MEDIA_UPLOAD_BYTES) {
    return { ok: false, message: MEDIA_TOO_BIG_MESSAGE };
  }
  const actual = detectMediaType(firstBytes);
  if (!actual) {
    return { ok: false, message: NOT_MEDIA_MESSAGE };
  }
  if (actual !== promised) {
    const rightEnding = EXTENSION_OF_CONTENT_TYPE[actual];
    return {
      ok: false,
      message: `This file is ${WHAT_THE_FILE_IS[actual]}, but its name ends in .${extension}. Rename it to end in .${rightEnding}, or upload another file.`,
    };
  }
  return { ok: true, contentType: actual, kind: KIND_OF_CONTENT_TYPE[actual], extension: EXTENSION_OF_CONTENT_TYPE[actual] };
}
