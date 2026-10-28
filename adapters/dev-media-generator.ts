import "server-only";
import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { DEV_STAND_IN_PROVIDER } from "@/lib/media/kinds";
import type { MediaProvider } from "@/lib/media-generation";

// Not a real vendor: the stand-in image maker used in development whenever
// MEDIA_PROVIDER is not set (lib/media-generation.ts refuses it in
// production). It makes a real PNG file of 1024 x 1024 pixels in one flat
// colour picked from the prompt, so the same prompt always gives the same
// colour, and it makes no videos: a video request fails honestly with
// "no_video_provider" instead of pretending. Nothing leaves this machine,
// and it costs nothing.

const SIDE = 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const devMediaGenerator: MediaProvider = {
  name: DEV_STAND_IN_PROVIDER,
  isStandIn: true,
  kinds: ["image"],
  outputHosts: [],
  requestTimeoutMs: 10_000,
  pollIntervalMs: 1_000,
  async start(request) {
    if (request.kind === "video") {
      return { status: "failed", code: "no_video_provider" };
    }
    return { status: "done", output: { bytes: flatColorPng(colorOfPrompt(request.prompt)), statedType: "image/png" }, costCents: 0 };
  },
  // It never hands out a job id to poll, so there is nothing to ask about.
  async poll() {
    return { status: "failed", code: "provider_failed" };
  },
};

// Three bytes of the prompt's SHA-256 hash: red, green and blue.
export function colorOfPrompt(prompt: string): [number, number, number] {
  const hash = createHash("sha256").update(prompt).digest();
  return [hash[0], hash[1], hash[2]];
}

// A PNG of SIDE x SIDE pixels, all one colour: the signature, then the
// IHDR (size, 8-bit RGB), IDAT (the rows, deflated) and IEND chunks.
export function flatColorPng([red, green, blue]: [number, number, number]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIDE, 0);
  header.writeUInt32BE(SIDE, 4);
  // Bit depth 8, colour type 2 (RGB); compression, filter and interlace 0.
  header.set([8, 2, 0, 0, 0], 8);
  // Each row: filter type 0 ("none", the zero Buffer.alloc left), then the
  // three bytes of the colour repeated for every pixel.
  const rowLength = 1 + SIDE * 3;
  const pixels = Buffer.alloc(rowLength * SIDE);
  const color = Buffer.from([red, green, blue]);
  for (let rowStart = 0; rowStart < pixels.length; rowStart += rowLength) {
    pixels.fill(color, rowStart + 1, rowStart + rowLength);
  }
  return Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(pixels)), pngChunk("IEND", Buffer.alloc(0))]);
}

// One chunk: its length, its type, its data, and a CRC-32 of type and data.
function pngChunk(type: string, data: Buffer): Buffer {
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, checksum]);
}
