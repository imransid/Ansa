// The orientation a JPEG's Exif block states (step 39). WHY it matters:
// phone cameras store a photo as the sensor saw it and write down how to
// turn it; browsers (and the platforms) show it turned, so a portrait photo
// is stored 4032 x 3024 with orientation 6. lib/media/dimensions.ts swaps
// the width and height for the orientations that turn it a quarter (5-8).
// Every read is bounds-checked: the bytes come from a stranger. Pure.

// "Exif" and two zero bytes start the block, then a TIFF header.
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
const ORIENTATION_TAG = 0x0112;
// A TIFF field of type SHORT: one 16-bit number.
const SHORT_TYPE = 3;
const IFD_ENTRY_BYTES = 12;

// The orientation (1-8) one APP1 segment states (its bytes after the
// length), or null when it is no Exif block, has no orientation, or is cut short.
export function readExifOrientation(segment: Uint8Array): number | null {
  if (segment.length < EXIF_HEADER.length + 8 || !EXIF_HEADER.every((byte, index) => segment[index] === byte)) {
    return null;
  }
  const tiff = segment.subarray(EXIF_HEADER.length);
  // "II": little-endian (Intel); "MM": big-endian (Motorola).
  const littleEndian = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!littleEndian && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) {
    return null;
  }
  const read16 = (offset: number) => (littleEndian ? tiff[offset] | (tiff[offset + 1] << 8) : (tiff[offset] << 8) | tiff[offset + 1]);
  const read32 = (offset: number) => (littleEndian ? read16(offset) + read16(offset + 2) * 0x10000 : read16(offset) * 0x10000 + read16(offset + 2));
  if (read16(2) !== 42) {
    return null;
  }
  // The first directory of fields, counted from the TIFF header.
  const directory = read32(4);
  if (directory + 2 > tiff.length) {
    return null;
  }
  const entries = read16(directory);
  for (let index = 0; index < entries; index++) {
    const entry = directory + 2 + index * IFD_ENTRY_BYTES;
    if (entry + IFD_ENTRY_BYTES > tiff.length) {
      return null;
    }
    if (read16(entry) === ORIENTATION_TAG) {
      // The value sits at the start of the entry's last four bytes.
      const orientation = read16(entry + 8);
      return read16(entry + 2) === SHORT_TYPE && orientation >= 1 && orientation <= 8 ? orientation : null;
    }
  }
  return null;
}
