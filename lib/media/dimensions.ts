import { readExifOrientation } from "./jpeg-orientation";
import type { MediaContentType } from "./kinds";

// An image's width and height as its own header states them (step 39), as
// it is shown (a JPEG turned by its Exif orientation), shown in the media
// library and kept for the platforms' size rules (step 41). null when they
// can't be read: a video (an MP4 keeps them deep in its boxes), or a header
// that is cut short or odd. Every read is bounds-checked: the bytes come
// from a stranger or an outside service. Pure.

export type ImageSize = { width: number; height: number };

// The largest side stored (the database's CHECK says the same): above it
// the header is taken for wrong, and the size for unknown.
export const MAX_IMAGE_SIDE = 100_000;

// JPEG markers that start a frame and state its size (SOF0-SOF15, without
// DHT 0xC4, JPG 0xC8 and DAC 0xCC).
const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
// Exif orientations 5 to 8 turn the picture a quarter (with or without a
// mirror): the side stored as its width is shown as its height.
const QUARTER_TURN_ORIENTATION = 5;

// The size of an image of this (already checked) type, or null.
export function readImageSize(bytes: Uint8Array, contentType: MediaContentType): ImageSize | null {
  switch (contentType) {
    case "image/png":
      return readPngSize(bytes);
    case "image/gif":
      return readGifSize(bytes);
    case "image/webp":
      return readWebpSize(bytes);
    case "image/jpeg":
      return readJpegSize(bytes);
    case "video/mp4":
      return null;
  }
}

// The IHDR chunk always comes first: its width and height, big-endian.
function readPngSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 24 || text(bytes, 12, 4) !== "IHDR") {
    return null;
  }
  return sized(uint32BigEndian(bytes, 16), uint32BigEndian(bytes, 20));
}

// The logical screen's width and height, little-endian, after "GIF89a".
function readGifSize(bytes: Uint8Array): ImageSize | null {
  return bytes.length < 10 ? null : sized(uint16LittleEndian(bytes, 6), uint16LittleEndian(bytes, 8));
}

// The first chunk says which of WebP's three formats it is, and each keeps
// the size its own way.
function readWebpSize(bytes: Uint8Array): ImageSize | null {
  const chunk = bytes.length >= 30 ? text(bytes, 12, 4) : "";
  if (chunk === "VP8X") {
    // The canvas size minus one, 24 bits each.
    return sized(uint24LittleEndian(bytes, 24) + 1, uint24LittleEndian(bytes, 27) + 1);
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    // 14 bits of width minus one, then 14 bits of height minus one.
    const bits = uint32LittleEndian(bytes, 21);
    return sized((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    // After the frame's start code: 14 bits of width, then of height.
    return sized(uint16LittleEndian(bytes, 26) & 0x3fff, uint16LittleEndian(bytes, 28) & 0x3fff);
  }
  return null;
}

// Walks the segments (each "FF <marker> <length>") to the frame header,
// which holds the height and then the width, as the picture is shown: an
// Exif block before it that turns the picture a quarter (a phone's portrait
// photo, lib/media/jpeg-orientation.ts) swaps them. Each step moves forward,
// so the walk ends within the file.
function readJpegSize(bytes: Uint8Array): ImageSize | null {
  let offset = 2;
  let orientation: number | null = null;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      return null;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      // A fill byte before a marker.
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      // Markers without a length.
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) {
      // The end, or the image data itself: no size came before it.
      return null;
    }
    if (JPEG_FRAME_MARKERS.has(marker)) {
      if (offset + 9 > bytes.length) {
        return null;
      }
      const [width, height] = [uint16BigEndian(bytes, offset + 7), uint16BigEndian(bytes, offset + 5)];
      return orientation !== null && orientation >= QUARTER_TURN_ORIENTATION ? sized(height, width) : sized(width, height);
    }
    const length = uint16BigEndian(bytes, offset + 2);
    if (length < 2) {
      return null;
    }
    // APP1: the first Exif block says how the picture is turned.
    if (marker === 0xe1 && orientation === null) {
      orientation = readExifOrientation(bytes.subarray(offset + 4, Math.min(bytes.length, offset + 2 + length)));
    }
    offset += 2 + length;
  }
  return null;
}

function sized(width: number, height: number): ImageSize | null {
  const fits = (side: number) => Number.isInteger(side) && side >= 1 && side <= MAX_IMAGE_SIDE;
  return fits(width) && fits(height) ? { width, height } : null;
}

function text(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function uint16BigEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function uint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function uint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

// ">>> 0" keeps the result positive when the top bit is set.
function uint32BigEndian(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function uint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}
