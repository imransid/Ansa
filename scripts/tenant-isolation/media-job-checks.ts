// Media job checks (step 39): a request is claimed by exactly one run, a
// run cut off is taken up later (at most 3 times, then "interrupted"), a
// service working in the background is polled with the id it gave (never
// asked twice), its result is fetched over https from its own host only
// and kept only when its bytes are of the kind asked (a file too big to
// keep says so); every failure is a code and never an asset. FAKE image
// services and downloads only.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { mediaAssets, mediaGenerationJobs } from "@/db/schema";
import { MAX_GENERATED_MEDIA_BYTES } from "@/lib/media/limits";
import type { ProviderPoll, ProviderStart } from "@/lib/media-generation";
import type { SessionContext } from "@/lib/session";
import { requestGenerationForSession } from "@/services/media-generation-jobs";
import { runGenerationJob, type GenerationRunOptions } from "@/services/media-generation-runs";
import { messageOf } from "./cofounder-helpers";
import { check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { fakeFetcher, fakeProvider, jobRow, MP4, neverRun, noSleep, PNG, SCRIPT, SVG } from "./media-helpers";

const SERVICE_HOST = "images.fake-service.test";

// A request of the session's company asked of this (fake) service, not yet run.
async function queuedJob(session: SessionContext, options: GenerationRunOptions, kind: "image" | "video" = "image"): Promise<string> {
  const result = await requestGenerationForSession(session, { kind, prompt: `A loaf ${runId}` }, neverRun, options);
  assert.ok(result.ok, messageOf(result));
  return result.jobId;
}

async function companyAssets(companyId: string) {
  return db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.companyId, companyId));
}

// Moves a job's run back in time: "being made" since `minutes` ago.
async function runStartedMinutesAgo(jobId: string, minutes: number, attempts: number) {
  await db
    .update(mediaGenerationJobs)
    .set({ status: "running", attempts, startedAt: new Date(Date.now() - minutes * 60_000) })
    .where(eq(mediaGenerationJobs.id, jobId));
}

const done = (output: { bytes: Buffer; statedType: string } | { url: string }): ProviderStart => ({ status: "done", output, costCents: 4 });

// A body of this many megabytes with no stated length, the same zero-filled
// megabyte sent again and again (so the check holds one in memory).
function megabytes(count: number): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent++ < count) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
  });
}

export async function runMediaJobChecks() {
  const owner = sessionFor(await signUpTestOwner("media-jobs"));

  await check("generation jobs: five runs of one request at the same moment make one request to the service and one asset", async () => {
    const service = fakeProvider({ start: done({ bytes: PNG, statedType: "image/png" }) });
    const jobId = await queuedJob(owner, { mode: service.mode });
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => runGenerationJob(owner.companyId, jobId, { mode: service.mode })));
    assert.deepEqual(outcomes.sort(), ["not-claimed", "not-claimed", "not-claimed", "not-claimed", "succeeded"]);
    assert.equal(service.calls.starts.length, 1);
    const job = await jobRow(jobId);
    assert.deepEqual([job.status, job.attempts, job.costCents], ["succeeded", 1, 4]);
    const made = (await companyAssets(owner.companyId)).filter((asset) => asset.id === job.assetId);
    assert.equal(made.length, 1);
  });

  await check("generation jobs: a run cut off is taken up 15 minutes later, at most 3 times in all, then ended as 'interrupted' without an asset; a run going on now is left alone", async () => {
    const service = fakeProvider({ start: done({ bytes: PNG, statedType: "image/png" }) });
    const fresh = await queuedJob(owner, { mode: service.mode });
    await runStartedMinutesAgo(fresh, 1, 1);
    assert.equal(await runGenerationJob(owner.companyId, fresh, { mode: service.mode }), "not-claimed");
    assert.deepEqual([(await jobRow(fresh)).status, service.calls.starts.length], ["running", 0]);
    await runStartedMinutesAgo(fresh, 16, 1);
    assert.equal(await runGenerationJob(owner.companyId, fresh, { mode: service.mode }), "succeeded");
    assert.equal((await jobRow(fresh)).attempts, 2);
    const worn = await queuedJob(owner, { mode: service.mode });
    await runStartedMinutesAgo(worn, 16, 3);
    assert.equal(await runGenerationJob(owner.companyId, worn, { mode: service.mode }), "not-claimed");
    const ended = await jobRow(worn);
    assert.deepEqual([ended.status, ended.lastError, ended.assetId, ended.attempts], ["failed", "interrupted", null, 3]);
    assert.equal(service.calls.starts.length, 1, "the service was asked again for a job out of runs");
  });

  await check("generation jobs: a service working in the background is polled with the id it gave, kept before the first poll; a later run polls it, never asks again", async () => {
    const fetcher = fakeFetcher([new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } })]);
    const polls: ProviderPoll[] = [{ status: "running" }, { status: "running" }, { status: "done", output: { url: `https://${SERVICE_HOST}/out/1.png` }, costCents: 7 }];
    const service = fakeProvider({ start: { status: "started", providerJobId: `svc-${runId}`, costCents: null }, polls });
    const jobId = await queuedJob(owner, { mode: service.mode });
    assert.equal(await runGenerationJob(owner.companyId, jobId, { mode: service.mode, sleep: noSleep, fetcher: fetcher.fetcher }), "succeeded");
    assert.deepEqual([service.calls.starts.length, service.calls.polls], [1, [`svc-${runId}`, `svc-${runId}`, `svc-${runId}`]]);
    assert.deepEqual(fetcher.asked, [`https://${SERVICE_HOST}/out/1.png`]);
    const job = await jobRow(jobId);
    assert.deepEqual([job.status, job.providerJobId, job.costCents], ["succeeded", `svc-${runId}`, 7]);
    // Time up while the service still works: unfinished, its id kept; the next run only polls.
    const slow = fakeProvider({ start: { status: "started", providerJobId: `slow-${runId}`, costCents: null }, polls: [{ status: "running" }] });
    const slowJob = await queuedJob(owner, { mode: slow.mode });
    // Real waits between polls (10 ms) until the 1.5 s budget leaves no room for another answer.
    assert.equal(await runGenerationJob(owner.companyId, slowJob, { mode: slow.mode, budgetMs: 1_500 }), "unfinished");
    assert.deepEqual([(await jobRow(slowJob)).status, (await jobRow(slowJob)).providerJobId], ["running", `slow-${runId}`]);
    await runStartedMinutesAgo(slowJob, 16, 1);
    const finishing = fakeProvider({ start: { status: "failed", code: "provider_failed" }, polls: [{ status: "done", output: { bytes: PNG, statedType: "image/png" }, costCents: null }] });
    assert.equal(await runGenerationJob(owner.companyId, slowJob, { mode: finishing.mode, sleep: noSleep }), "succeeded");
    assert.deepEqual([finishing.calls.starts.length, finishing.calls.polls], [0, [`slow-${runId}`]]);
  });

  await check("generation jobs: a result is fetched only over https from the service's own host (every redirect too), and kept only when its bytes are of the kind asked; a file over 100 MB (stated or counted) is 'output_too_large'; otherwise a code and never an asset", async () => {
    const huge = `https://${SERVICE_HOST}/huge.png`;
    const statedTooLarge = new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png", "content-length": String(MAX_GENERATED_MEDIA_BYTES + 1) } });
    const cases: { output: { bytes: Buffer; statedType: string } | { url: string }; responses?: Response[]; kind?: "image" | "video"; code: string; fetched: string[] }[] = [
      { output: { url: huge }, responses: [statedTooLarge], code: "output_too_large", fetched: [huge] },
      { output: { url: huge }, responses: [new Response(megabytes(101), { headers: { "content-type": "image/png" } })], code: "output_too_large", fetched: [huge] },
      { output: { url: `http://${SERVICE_HOST}/x.png` }, code: "download_failed", fetched: [] },
      { output: { url: "https://evil.test/x.png" }, code: "download_failed", fetched: [] },
      { output: { url: `https://${SERVICE_HOST}:8443/x.png` }, code: "download_failed", fetched: [] },
      {
        output: { url: `https://${SERVICE_HOST}/x.png` },
        responses: [new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest/meta-data" } })],
        code: "download_failed",
        fetched: [`https://${SERVICE_HOST}/x.png`],
      },
      { output: { url: `https://${SERVICE_HOST}/x.png` }, responses: [new Response("<html></html>", { headers: { "content-type": "text/html" } })], code: "download_failed", fetched: [`https://${SERVICE_HOST}/x.png`] },
      { output: { bytes: SCRIPT, statedType: "image/png" }, code: "unexpected_output", fetched: [] },
      { output: { bytes: SVG, statedType: "image/svg+xml" }, code: "unexpected_output", fetched: [] },
      { output: { bytes: MP4, statedType: "video/mp4" }, kind: "image", code: "unexpected_output", fetched: [] },
      { output: { bytes: PNG, statedType: "image/png" }, kind: "video", code: "unexpected_output", fetched: [] },
    ];
    const assetsBefore = (await companyAssets(owner.companyId)).length;
    for (const [index, entry] of cases.entries()) {
      const service = fakeProvider({ start: done(entry.output) });
      const fetcher = fakeFetcher(entry.responses ?? []);
      const jobId = await queuedJob(owner, { mode: service.mode }, entry.kind ?? "image");
      assert.equal(await runGenerationJob(owner.companyId, jobId, { mode: service.mode, fetcher: fetcher.fetcher }), "failed", `case ${index}`);
      const job = await jobRow(jobId);
      assert.deepEqual([job.status, job.lastError, job.assetId], ["failed", entry.code, null], `case ${index}`);
      assert.deepEqual(fetcher.asked, entry.fetched, `case ${index}: fetched`);
    }
    assert.equal((await companyAssets(owner.companyId)).length, assetsBefore, "a failed job left an asset");
    // An octet-stream answer whose bytes are a PNG is a PNG.
    const service = fakeProvider({ start: done({ url: `https://${SERVICE_HOST}/y` }) });
    const fetcher = fakeFetcher([new Response(new Uint8Array(PNG), { headers: { "content-type": "application/octet-stream" } })]);
    const jobId = await queuedJob(owner, { mode: service.mode });
    assert.equal(await runGenerationJob(owner.companyId, jobId, { mode: service.mode, fetcher: fetcher.fetcher }), "succeeded");
  });

  await check("generation jobs: a service that throws, refuses or never answers fails the job with its code (provider_failed, provider_refused, provider_timeout), never an asset", async () => {
    const throwing = fakeProvider({ start: done({ bytes: PNG, statedType: "image/png" }) });
    throwing.provider.start = async () => {
      throw new Error(`The service quotes the prompt: A loaf ${runId}`);
    };
    const silent = fakeProvider({ start: done({ bytes: PNG, statedType: "image/png" }) });
    silent.provider.requestTimeoutMs = 50;
    silent.provider.start = () => new Promise<ProviderStart>(() => {});
    const refusing = fakeProvider({ start: { status: "failed", code: "provider_refused" } });
    for (const [service, code] of [[throwing, "provider_failed"], [refusing, "provider_refused"], [silent, "provider_timeout"]] as const) {
      const jobId = await queuedJob(owner, { mode: service.mode });
      assert.equal(await runGenerationJob(owner.companyId, jobId, { mode: service.mode }), "failed");
      const job = await jobRow(jobId);
      assert.deepEqual([job.lastError, job.assetId], [code, null]);
    }
  });
}
