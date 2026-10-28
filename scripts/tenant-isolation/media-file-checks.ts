// Media file checks (step 39): an upload's type comes from its own first
// bytes and must match its name (a PNG named .jpg, a script named .png and
// any SVG are refused, in the browser's check and on the server, before
// anything is stored); files are at most 4 MB; a stored file sits under
// media/<companyId>/<assetId>.<ext>, its name shown as one plain line and
// its image size read from its header (as shown: a JPEG turned by its Exif
// orientation); and the development stand-in makes a real PNG. Uses the
// .dev-files/ stand-in only.

import assert from "node:assert/strict";
import { crc32, inflateSync } from "node:zlib";
import { colorOfPrompt, devMediaGenerator, flatColorPng } from "@/adapters/dev-media-generator";
import { readImageSize } from "@/lib/media/dimensions";
import { checkMediaFile, MEDIA_TOO_BIG_MESSAGE, NOT_MEDIA_MESSAGE, SVG_MEDIA_MESSAGE } from "@/lib/media/files";
import { MAX_MEDIA_UPLOAD_BYTES } from "@/lib/media/limits";
import { detectMediaType } from "@/lib/media/signatures";
import { listMediaForSession } from "@/services/media-library";
import { messageOf } from "./cofounder-helpers";
import { check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { assetRow, GIF, HEIC, JPEG, MP4, PNG, SCRIPT, storedFiles, SVG, upload, uploadedAssetId, WEBP } from "./media-helpers";

// The 640 x 480 JPEG with an Exif block (APP1, right after its start)
// saying how to turn it, as a phone writes one: its TIFF numbers
// little-endian ("II") or big-endian ("MM"), one field, the orientation.
function jpegWithOrientation(orientation: number, byteOrder: "II" | "MM" = "II"): Buffer {
  const tiff = Buffer.alloc(26);
  const littleEndian = byteOrder === "II";
  const write16 = (value: number, offset: number) => (littleEndian ? tiff.writeUInt16LE(value, offset) : tiff.writeUInt16BE(value, offset));
  const write32 = (value: number, offset: number) => (littleEndian ? tiff.writeUInt32LE(value, offset) : tiff.writeUInt32BE(value, offset));
  tiff.write(byteOrder, 0, "latin1");
  write16(42, 2);
  write32(8, 4); // the first directory, right after this header
  write16(1, 8); // one field:
  write16(0x0112, 10); // Orientation,
  write16(3, 12); // a SHORT,
  write32(1, 14); // one of them,
  write16(orientation, 18); // this one (then no next directory)
  const exif = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(exif.length + 2);
  return Buffer.concat([JPEG.subarray(0, 2), Buffer.from([0xff, 0xe1]), length, exif, JPEG.subarray(2)]);
}

// A file of exactly `size` bytes that starts like `start`.
function padded(start: Buffer, size: number): Buffer {
  return Buffer.concat([start, Buffer.alloc(size - start.length, 7)]);
}

export async function runMediaFileChecks() {
  await check("media files: each accepted type is told by its own first bytes, and anything else is not (a script, an SVG, a HEIF photo, a PDF, too few bytes)", async () => {
    const told = [PNG, JPEG, GIF, WEBP, MP4].map((bytes) => detectMediaType(bytes));
    assert.deepEqual(told, ["image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4"]);
    for (const other of [SCRIPT, SVG, HEIC, Buffer.from("%PDF-1.7\n"), PNG.subarray(0, 7), Buffer.alloc(0), Buffer.from("RIFF0000WAVE")]) {
      assert.equal(detectMediaType(other), null, other.subarray(0, 12).toString("hex"));
    }
  });

  await check("media files: a PNG named .jpg, a script named .png and an SVG are refused, in the browser's check and on the server, and nothing is stored", async () => {
    const owner = sessionFor(await signUpTestOwner("media-sniff"));
    const refusals: [Buffer, string, RegExp][] = [
      [PNG, "photo.jpg", /This file is a PNG image, but its name ends in \.jpg\. Rename it to end in \.png/],
      [JPEG, "photo.png", /This file is a JPEG image, but its name ends in \.png/],
      [MP4, "clip.gif", /This file is an MP4 video, but its name ends in \.gif/],
      [SCRIPT, "innocent.png", new RegExp(NOT_MEDIA_MESSAGE.replace(/[.]/g, "\\."))],
      [HEIC, "holiday.mp4", /isn't a PNG, JPEG, WebP, GIF or MP4 file/],
      [SVG, "logo.svg", new RegExp(SVG_MEDIA_MESSAGE.slice(0, 40))],
      [SVG, "logo.SVG", /SVG images can't be uploaded/],
      [PNG, "photo.bmp", /Upload a PNG, JPEG, WebP or GIF image, or an MP4 video/],
      [PNG, "no-extension", /Upload a PNG, JPEG, WebP or GIF image, or an MP4 video/],
    ];
    for (const [bytes, name, expected] of refusals) {
      const inBrowser = checkMediaFile({ name, size: bytes.length }, bytes);
      assert.ok(!inBrowser.ok && expected.test(inBrowser.message), `browser: ${name}: ${JSON.stringify(inBrowser)}`);
      assert.match(messageOf(await upload(owner, bytes, name)), expected, `server: ${name}`);
    }
    assert.deepEqual(await listMediaForSession(owner, 1), []);
    assert.deepEqual(await storedFiles(owner.companyId), []);
  });

  await check("media files: at most 4 MB (one byte more is refused before anything is stored), and an empty file is refused", async () => {
    const owner = sessionFor(await signUpTestOwner("media-size"));
    const tooBig = padded(PNG, MAX_MEDIA_UPLOAD_BYTES + 1);
    assert.equal(messageOf(await upload(owner, tooBig, "big.png")), MEDIA_TOO_BIG_MESSAGE);
    assert.match(messageOf(await upload(owner, Buffer.alloc(0), "empty.png")), /Choose an image or a video/);
    assert.deepEqual(await storedFiles(owner.companyId), []);
    assert.deepEqual(await upload(owner, padded(PNG, MAX_MEDIA_UPLOAD_BYTES), "just-fits.png"), { ok: true });
    const [stored] = await listMediaForSession(owner, 1);
    assert.equal(stored.sizeBytes, MAX_MEDIA_UPLOAD_BYTES);
  });

  await check("media files: an upload is stored under media/<companyId>/<assetId>.<ext>, with the type its bytes say, its size, its image size, and its name as one plain line", async () => {
    const owner = sessionFor(await signUpTestOwner("media-store"));
    // A right-to-left override would show "gpj.exe" as "exe.jpg"; line breaks would break the list.
    const assetId = await uploadedAssetId(owner, JPEG, `  Lunch\u202Egpj.exe\n menu ${runId}.JPEG`);
    const row = await assetRow(assetId);
    assert.equal(row.storageKey, `media/${owner.companyId}/${assetId}.jpg`);
    assert.deepEqual([row.kind, row.source, row.contentType, row.sizeBytes], ["image", "upload", "image/jpeg", JPEG.length]);
    assert.deepEqual([row.width, row.height], [640, 480]);
    assert.equal(row.originalName, `Lunchgpj.exe menu ${runId}.JPEG`);
    assert.deepEqual(await storedFiles(owner.companyId), [`${assetId}.jpg`]);
    const videoId = await uploadedAssetId(owner, MP4, "clip.mp4");
    const video = await assetRow(videoId);
    assert.deepEqual([video.kind, video.contentType, video.width, video.height, video.storageKey.endsWith(".mp4")], ["video", "video/mp4", null, null, true]);
  });

  await check("image sizes: PNG, GIF, WebP and JPEG headers give their width and height; a cut-short or odd header, and a video, give none", async () => {
    assert.deepEqual(readImageSize(PNG, "image/png"), { width: 1024, height: 1024 });
    assert.deepEqual(readImageSize(GIF, "image/gif"), { width: 1, height: 1 });
    assert.deepEqual(readImageSize(WEBP, "image/webp"), { width: 1, height: 1 });
    assert.deepEqual(readImageSize(JPEG, "image/jpeg"), { width: 640, height: 480 });
    // A JPEG with its fill bytes and markers out of the usual order still reads; one cut before its frame header doesn't.
    assert.deepEqual(readImageSize(Buffer.concat([JPEG.subarray(0, 2), Buffer.from("ffff", "hex"), JPEG.subarray(2)]), "image/jpeg"), { width: 640, height: 480 });
    assert.equal(readImageSize(JPEG.subarray(0, 24), "image/jpeg"), null);
    assert.equal(readImageSize(PNG.subarray(0, 20), "image/png"), null);
    // A zero-length segment would never move on: it ends the walk instead.
    assert.equal(readImageSize(Buffer.from("ffd8ffe00000ffc0", "hex"), "image/jpeg"), null);
    // A header claiming more than 100,000 pixels a side is taken for wrong.
    const hugePng = Buffer.from(PNG);
    hugePng.writeUInt32BE(200_000, 16);
    assert.equal(readImageSize(hugePng, "image/png"), null);
    assert.equal(readImageSize(MP4, "video/mp4"), null);
  });

  await check("image sizes: a JPEG whose Exif orientation turns it a quarter (a phone's portrait photo, 5-8) is as wide as it is shown, either byte order; upright or upside down, a broken Exif block, or none, keep the stated sides", async () => {
    assert.deepEqual(readImageSize(jpegWithOrientation(6), "image/jpeg"), { width: 480, height: 640 });
    assert.deepEqual(readImageSize(jpegWithOrientation(8, "MM"), "image/jpeg"), { width: 480, height: 640 });
    assert.deepEqual(readImageSize(jpegWithOrientation(5, "MM"), "image/jpeg"), { width: 480, height: 640 });
    assert.deepEqual(readImageSize(jpegWithOrientation(1), "image/jpeg"), { width: 640, height: 480 });
    assert.deepEqual(readImageSize(jpegWithOrientation(3, "MM"), "image/jpeg"), { width: 640, height: 480 });
    assert.deepEqual(readImageSize(jpegWithOrientation(9), "image/jpeg"), { width: 640, height: 480 });
    // The directory's place said to be far past the block's end: no orientation is read.
    const broken = jpegWithOrientation(6);
    broken.writeUInt32LE(1000, 16);
    assert.deepEqual(readImageSize(broken, "image/jpeg"), { width: 640, height: 480 });
    // Cut inside the Exif block: the frame header never comes.
    assert.equal(readImageSize(jpegWithOrientation(6).subarray(0, 30), "image/jpeg"), null);
    // An upload keeps the sides as shown, for the platforms' size rules (step 41).
    const owner = sessionFor(await signUpTestOwner("media-portrait"));
    const stored = await assetRow(await uploadedAssetId(owner, jpegWithOrientation(6), "portrait.jpg"));
    assert.deepEqual([stored.width, stored.height], [480, 640]);
  });

  await check("dev stand-in: a real PNG of 1024 x 1024 in one colour from the prompt (the same prompt, the same colour), and no video", async () => {
    const answer = await devMediaGenerator.start({ kind: "image", prompt: `Sourdough on a counter ${runId}` });
    assert.ok(answer.status === "done" && "bytes" in answer.output, JSON.stringify(answer));
    const bytes = answer.output.bytes;
    assert.equal(detectMediaType(bytes), "image/png");
    assert.deepEqual(readImageSize(bytes, "image/png"), { width: 1024, height: 1024 });
    assert.ok(bytes.equals(flatColorPng(colorOfPrompt(`Sourdough on a counter ${runId}`))));
    // Every chunk's checksum is right, and the pixels are the prompt's colour.
    const chunks: { type: string; data: Buffer }[] = [];
    for (let offset = 8; offset < bytes.length; ) {
      const length = bytes.readUInt32BE(offset);
      const typeAndData = bytes.subarray(offset + 4, offset + 8 + length);
      assert.equal(bytes.readUInt32BE(offset + 8 + length), crc32(typeAndData), "a chunk's CRC is wrong");
      chunks.push({ type: typeAndData.subarray(0, 4).toString("ascii"), data: typeAndData.subarray(4) });
      offset += 12 + length;
    }
    assert.deepEqual(chunks.map((chunk) => chunk.type), ["IHDR", "IDAT", "IEND"]);
    const pixels = inflateSync(chunks[1].data);
    assert.equal(pixels.length, 1024 * (1 + 1024 * 3));
    const [red, green, blue] = colorOfPrompt(`Sourdough on a counter ${runId}`);
    assert.deepEqual([pixels[0], pixels[1], pixels[2], pixels[3], pixels.at(-1)], [0, red, green, blue, blue]);
    assert.notDeepEqual(colorOfPrompt("one prompt"), colorOfPrompt("another prompt"));
    assert.deepEqual(await devMediaGenerator.start({ kind: "video", prompt: "A video" }), { status: "failed", code: "no_video_provider" });
  });
}
