import type { MediaContentType } from "./kinds";

// Which of the accepted file types some bytes are, read from the signature
// each such file starts with (step 39). WHY not the file's name or the
// browser's type: both say whatever the sender wants. The upload form in the
// browser, services/media-library.ts and the generated files
// (services/media-generation-runs.ts) all decide here. Pure.

// How many first bytes the signatures need: an MP4's brand ends at byte 12.
export const SIGNATURE_BYTES = 16;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];

// Still images that use the same "ftyp" box as an MP4 (HEIF and AVIF
// photos): a browser can't play them as a video, so they aren't one.
const STILL_IMAGE_BRANDS = ["heic", "heix", "heim", "heis", "mif1", "msf1", "avif", "avis"];

// The accepted type these bytes start, or null when they start none of them
// (a script, an SVG, a PDF, a HEIF photo, too few bytes...).
export function detectMediaType(bytes: Uint8Array): MediaContentType | null {
  if (startsWith(bytes, PNG, 0)) {
    return "image/png";
  }
  if (startsWith(bytes, JPEG, 0)) {
    return "image/jpeg";
  }
  if (startsWithText(bytes, "GIF87a", 0) || startsWithText(bytes, "GIF89a", 0)) {
    return "image/gif";
  }
  // RIFF, then the size of the file (4 bytes), then WEBP.
  if (startsWithText(bytes, "RIFF", 0) && startsWithText(bytes, "WEBP", 8)) {
    return "image/webp";
  }
  // The box size (4 bytes), "ftyp", then the major brand (4 letters).
  if (startsWithText(bytes, "ftyp", 4) && bytes.length >= 12 && !STILL_IMAGE_BRANDS.includes(textAt(bytes, 8, 4))) {
    return "video/mp4";
  }
  return null;
}

function startsWith(bytes: Uint8Array, expected: number[], offset: number): boolean {
  return bytes.length >= offset + expected.length && expected.every((value, index) => bytes[offset + index] === value);
}

function startsWithText(bytes: Uint8Array, text: string, offset: number): boolean {
  return startsWith(bytes, [...text].map((letter) => letter.charCodeAt(0)), offset);
}

function textAt(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
