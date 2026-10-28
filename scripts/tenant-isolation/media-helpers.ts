// Shared pieces for the media library checks (step 39): real file
// signatures of each accepted type (and of some refused ones), uploading as
// the media page does, stand-ins for the image service and for Next's
// after(), and what the database holds. No real image service and no real
// network: the services get fakes.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { flatColorPng } from "@/adapters/dev-media-generator";
import { db } from "@/db/client";
import { mediaAssets, mediaGenerationJobs } from "@/db/schema";
import type { MediaGenerationMode, MediaProvider, ProviderPoll, ProviderStart } from "@/lib/media-generation";
import type { SessionContext } from "@/lib/session";
import type { RunAfterResponse } from "@/services/media-generation-jobs";
import { listMediaForSession, uploadMediaForSession } from "@/services/media-library";
import { runId } from "./helpers";

// A real PNG of 1024 x 1024 pixels (the stand-in's own maker).
export const PNG = flatColorPng([10, 20, 30]);

// The classic 1 x 1 GIF.
export const GIF = Buffer.from("47494638396101000100800000ffffff00000021f90401000000002c00000000010001000002024401003b", "hex");

// A 1 x 1 lossless WebP.
export const WEBP = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");

// The start of a JPEG of 640 x 480: SOI, a JFIF APP0 segment, then the
// frame header (SOF0) with its height and width, and EOI.
export const JPEG = Buffer.concat([
  Buffer.from("ffd8", "hex"),
  Buffer.from("ffe000104a46494600010100000100010000", "hex"),
  Buffer.from("ffc0001108", "hex"),
  Buffer.from([0x01, 0xe0, 0x02, 0x80]),
  Buffer.from("03012200021101031101", "hex"),
  Buffer.from("ffd9", "hex"),
]);

// An MP4's first box ("ftyp", brand mp42), then a little of the rest.
export const MP4 = Buffer.concat([Buffer.from("00000018667479706d703432000000006d70343269736f6d", "hex"), Buffer.alloc(64, 1)]);

// A HEIF photo starts like an MP4, with a still-image brand.
export const HEIC = Buffer.concat([Buffer.from("0000001866747970686569630000000068656963", "hex"), Buffer.alloc(64, 1)]);

export const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
export const SCRIPT = Buffer.from("<script>alert(document.cookie)</script>");

// A file as the browser sends it.
export function fileOf(bytes: Buffer, name: string): File {
  return new File([new Uint8Array(bytes)], name, { type: "" });
}

// Uploads as the media page does; the result.
export async function upload(session: SessionContext, bytes: Buffer, name: string, altText: string | null = null) {
  return uploadMediaForSession(session, { file: fileOf(bytes, name), altText });
}

// Uploads a file that must be accepted: the new asset's id.
export async function uploadedAssetId(session: SessionContext, bytes: Buffer = PNG, name = "photo.png"): Promise<string> {
  assert.deepEqual(await upload(session, bytes, name), { ok: true });
  const [newest] = await listMediaForSession(session, 1);
  assert.ok(newest, "the upload is not in the library");
  return newest.id;
}

// The files a company's folder of the .dev-files/ stand-in holds.
export async function storedFiles(companyId: string): Promise<string[]> {
  return readdir(path.join(process.cwd(), ".dev-files", "media", companyId)).catch(() => []);
}

// Rows as if files had been stored earlier (no file behind them): for the
// library's totals, and its pages.
export async function pretendStored(session: SessionContext, count: number, sizeBytes: number): Promise<void> {
  const rows = Array.from({ length: count }, () => {
    const id = randomUUID();
    return {
      id,
      companyId: session.companyId,
      kind: "image" as const,
      source: "upload" as const,
      contentType: "image/png" as const,
      sizeBytes,
      storageKey: `media/${session.companyId}/${id}.png`,
      originalName: `earlier-${runId}.png`,
      createdByUserId: session.userId,
    };
  });
  await db.insert(mediaAssets).values(rows);
}

export async function assetRow(assetId: string) {
  const [row] = await db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId));
  return row;
}

export async function jobRow(jobId: string) {
  const [row] = await db.select().from(mediaGenerationJobs).where(eq(mediaGenerationJobs.id, jobId));
  assert.ok(row, "the job is not in the database");
  return row;
}

// A stand-in for Next's after(): keeps the tasks, and runs them all when
// the check says so (as the host does once the page has answered).
export function collectingAfter() {
  const tasks: (() => Promise<unknown>)[] = [];
  const run: RunAfterResponse = (task) => {
    tasks.push(task);
  };
  const settle = async () => {
    const waiting = tasks.splice(0);
    return Promise.all(waiting.map((task) => task()));
  };
  return { run, tasks, settle };
}

// A run's afterwards discarded: for requests whose run a check doesn't want.
export const neverRun: RunAfterResponse = () => {};

// A fake image service that answers from a script and records what it was
// asked. start: what the first request gets; polls: what each poll gets in
// turn (the last one again once they run out).
export function fakeProvider(script: { name?: string; start: ProviderStart; polls?: ProviderPoll[]; outputHosts?: string[]; kinds?: ("image" | "video")[] }) {
  const calls = { starts: [] as string[], polls: [] as string[] };
  const polls = script.polls ?? [{ status: "running" }];
  const provider: MediaProvider = {
    name: script.name ?? "fake-service",
    isStandIn: false,
    kinds: script.kinds ?? ["image", "video"],
    outputHosts: script.outputHosts ?? ["images.fake-service.test"],
    requestTimeoutMs: 1_000,
    pollIntervalMs: 10,
    async start(request) {
      calls.starts.push(request.prompt);
      return script.start;
    },
    async poll(providerJobId) {
      calls.polls.push(providerJobId);
      return polls[Math.min(calls.polls.length - 1, polls.length - 1)];
    },
  };
  return { provider, calls, mode: { kind: "on", provider } as MediaGenerationMode };
}

// Answers a fetch from a script of responses, recording what it was asked.
export function fakeFetcher(responses: Response[]) {
  const asked: string[] = [];
  const fetcher = async (url: string) => {
    asked.push(url);
    return responses.shift() ?? new Response(null, { status: 500 });
  };
  return { fetcher, asked };
}

// Polls take no time in the checks.
export const noSleep = async () => {};
