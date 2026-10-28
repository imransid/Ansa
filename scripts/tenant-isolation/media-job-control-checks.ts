// Media job control checks (step 39): Cancel works only while a request
// waits (anyone in the company, never another company) and a canceled one
// is never run; "Start now" runs only a stuck one; the scheduled job finds
// stuck requests of every company, runs them through their own path in
// turn with emails and calls, only while their slowest run still fits; a
// company keeps at most 300 files and 500 MB, uploads and generated files
// together (requests still waiting count, and a result that comes back to
// a full library isn't kept); and no prompt or address of a service
// reaches the logs. FAKE image services only.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { cancelGenerationJob } from "@/db/media-generation-jobs";
import { mediaGenerationJobs } from "@/db/schema";
import { MAX_MEDIA_ASSETS_PER_COMPANY, MAX_MEDIA_STORAGE_BYTES_PER_COMPANY } from "@/lib/media/limits";
import type { SessionContext } from "@/lib/session";
import { cancelGenerationForSession, startStuckGenerationForSession } from "@/services/media-generation-control";
import { listGenerationJobsForSession, requestGenerationForSession } from "@/services/media-generation-jobs";
import { LONGEST_GENERATION_MS, runGenerationJob } from "@/services/media-generation-runs";
import { MEDIA_LIBRARY_FULL_MESSAGE } from "@/services/media-library";
import { findStuckWork, JOB_MAX_DURATION_MS, runStuckWork } from "@/services/stuck-work";
import { messageOf } from "./cofounder-helpers";
import { addTeammate, captureConsole, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { collectingAfter, fakeFetcher, fakeProvider, GIF, jobRow, neverRun, PNG, pretendStored, storedFiles, upload } from "./media-helpers";

async function queuedJob(session: SessionContext, prompt = `A loaf ${runId}`): Promise<string> {
  const result = await requestGenerationForSession(session, { kind: "image", prompt }, neverRun);
  assert.ok(result.ok, messageOf(result));
  return result.jobId;
}

export async function runMediaJobControlChecks() {
  await check("generation jobs: another company can't list, run or cancel a company's request; Cancel works only while it waits, for anyone in the company; a canceled one is never run", async () => {
    const ownerUser = await signUpTestOwner("media-cancel");
    const owner = sessionFor(ownerUser);
    const other = sessionFor(await signUpTestOwner("media-cancel-other"));
    const jobId = await queuedJob(owner);
    assert.deepEqual(await listGenerationJobsForSession(other), []);
    assert.deepEqual((await listGenerationJobsForSession(owner)).map((job) => job.id), [jobId]);
    // A run under another company's id claims nothing.
    assert.equal(await runGenerationJob(other.companyId, jobId), "not-claimed");
    assert.deepEqual([(await jobRow(jobId)).status, (await jobRow(jobId)).attempts], ["queued", 0]);
    assert.match(messageOf(await cancelGenerationForSession(other, { jobId })), /couldn't find that request/);
    assert.equal(await cancelGenerationJob(other.companyId, other.userId, jobId), "not-found");
    assert.equal(await cancelGenerationJob(owner.companyId, other.userId, jobId), "not-allowed");
    assert.equal((await jobRow(jobId)).status, "queued");
    const member = sessionFor(await addTeammate(ownerUser, "media-cancel-mate", "member"));
    assert.deepEqual(await cancelGenerationForSession(member, { jobId: jobId.toUpperCase() }), { ok: true });
    const canceled = await jobRow(jobId);
    assert.deepEqual([canceled.status, canceled.assetId, canceled.attempts], ["canceled", null, 0]);
    assert.ok(canceled.finishedAt);
    const service = fakeProvider({ start: { status: "done", output: { bytes: PNG, statedType: "image/png" }, costCents: null } });
    assert.equal(await runGenerationJob(owner.companyId, jobId, { mode: service.mode }), "not-claimed");
    assert.deepEqual([service.calls.starts.length, (await jobRow(jobId)).status], [0, "canceled"]);
    assert.match(messageOf(await cancelGenerationForSession(owner, { jobId })), /can't be canceled any more/);
    // Being made: too late to cancel.
    const running = await queuedJob(owner);
    await db.update(mediaGenerationJobs).set({ status: "running", attempts: 1, startedAt: new Date() }).where(eq(mediaGenerationJobs.id, running));
    assert.match(messageOf(await cancelGenerationForSession(owner, { jobId: running })), /can't be canceled any more/);
  });

  await check("generation jobs: 'Start now' runs a stuck request (waiting 2+ minutes, or cut off 15+ minutes ago) after the answer, and refuses one that isn't stuck or isn't the company's", async () => {
    const owner = sessionFor(await signUpTestOwner("media-start-now"));
    const other = sessionFor(await signUpTestOwner("media-start-now-other"));
    const jobId = await queuedJob(owner);
    const after = collectingAfter();
    assert.match(messageOf(await startStuckGenerationForSession(owner, { jobId }, after.run)), /isn't stuck/);
    await db.update(mediaGenerationJobs).set({ createdAt: new Date(Date.now() - 3 * 60_000) }).where(eq(mediaGenerationJobs.id, jobId));
    assert.match(messageOf(await startStuckGenerationForSession(other, { jobId }, after.run)), /couldn't find that request/);
    assert.equal(after.tasks.length, 0);
    assert.deepEqual(await startStuckGenerationForSession(owner, { jobId }, after.run), { ok: true });
    assert.deepEqual(await after.settle(), ["succeeded"]);
    assert.equal((await jobRow(jobId)).status, "succeeded");
  });

  await check("stuck work: the scheduled job finds stuck image requests of every company (never fresh ones) and runs them through their own path, only while their slowest run still fits", async () => {
    assert.ok(LONGEST_GENERATION_MS < JOB_MAX_DURATION_MS, `${LONGEST_GENERATION_MS} ms`);
    const owner = sessionFor(await signUpTestOwner("media-stuck"));
    const fresh = await queuedJob(owner);
    const waiting = await queuedJob(owner);
    await db.update(mediaGenerationJobs).set({ createdAt: new Date("2000-01-01T00:00:00Z") }).where(eq(mediaGenerationJobs.id, waiting));
    const cutOff = await queuedJob(owner);
    await db.update(mediaGenerationJobs).set({ status: "running", attempts: 1, startedAt: new Date("2000-01-02T00:00:00Z") }).where(eq(mediaGenerationJobs.id, cutOff));
    const work = await findStuckWork();
    const found = work.generations.filter((item) => [fresh, waiting, cutOff].includes(item.id));
    // Least recently tried first: the one waiting since longest, then the one cut off.
    assert.deepEqual(found, [{ companyId: owner.companyId, id: waiting }, { companyId: owner.companyId, id: cutOff }]);
    // Asked of the development stand-in, which runs them again.
    const own = { emails: [], calls: [], generations: found };
    const startedWithTimeLeft = (leftMs: number) => Date.now() - (JOB_MAX_DURATION_MS - leftMs);
    assert.deepEqual(await runStuckWork(own, {}, startedWithTimeLeft(LONGEST_GENERATION_MS - 1_000)), { emails: 0, calls: 0, generations: 0 });
    assert.deepEqual(await runStuckWork(own, {}), { emails: 0, calls: 0, generations: 2 });
    assert.deepEqual([(await jobRow(waiting)).status, (await jobRow(cutOff)).status, (await jobRow(fresh)).status], ["succeeded", "succeeded", "queued"]);
  });

  await check("media cap: a company keeps at most 300 files and 500 MB, uploads and generated files together; another company's don't count; a request is refused when it is full", async () => {
    const owner = sessionFor(await signUpTestOwner("media-cap"));
    await pretendStored(sessionFor(await signUpTestOwner("media-cap-other")), 20, 10);
    await pretendStored(owner, MAX_MEDIA_ASSETS_PER_COMPANY - 1, 10);
    assert.deepEqual(await upload(owner, GIF, "the-300th.gif"), { ok: true });
    assert.equal(messageOf(await upload(owner, GIF, "one-too-many.gif")), MEDIA_LIBRARY_FULL_MESSAGE);
    assert.equal(messageOf(await requestGenerationForSession(owner, { kind: "image", prompt: "Bread" }, neverRun)), MEDIA_LIBRARY_FULL_MESSAGE);
    const bytesOwner = sessionFor(await signUpTestOwner("media-cap-bytes"));
    // Five files of 100 MB (the largest one file can be) minus 100 bytes in all.
    await pretendStored(bytesOwner, 4, 100 * 1024 * 1024);
    await pretendStored(bytesOwner, 1, MAX_MEDIA_STORAGE_BYTES_PER_COMPANY - 4 * 100 * 1024 * 1024 - 100);
    assert.equal(messageOf(await upload(bytesOwner, PNG, "too-big-now.png")), MEDIA_LIBRARY_FULL_MESSAGE);
    assert.deepEqual(await upload(bytesOwner, GIF, "still-fits.gif"), { ok: true });
  });

  await check("media cap: requests still waiting count as files (the 300th is refused while 2 wait beside 298), and a result coming back to a full library fails 'library_full': no asset, no file left", async () => {
    const owner = sessionFor(await signUpTestOwner("media-cap-requests"));
    await pretendStored(owner, MAX_MEDIA_ASSETS_PER_COMPANY - 2, 10);
    const first = await queuedJob(owner);
    await queuedJob(owner);
    assert.equal(messageOf(await requestGenerationForSession(owner, { kind: "image", prompt: "One too many" }, neverRun)), MEDIA_LIBRARY_FULL_MESSAGE);
    // Two uploads slipped in meanwhile (they don't count requests): the library is full when the first comes back.
    await pretendStored(owner, 2, 10);
    const { result, logs } = await captureConsole(() => runGenerationJob(owner.companyId, first));
    assert.deepEqual([result, logs], ["failed", ["Media generation failed: library_full"]]);
    const job = await jobRow(first);
    assert.deepEqual([job.status, job.lastError, job.assetId], ["failed", "library_full", null]);
    assert.deepEqual(await storedFiles(owner.companyId), [], "the made file was left in storage");
    // By size: one byte of room left takes a request, but no room for the stand-in's PNG.
    const bytesOwner = sessionFor(await signUpTestOwner("media-cap-request-bytes"));
    await pretendStored(bytesOwner, 4, 100 * 1024 * 1024);
    await pretendStored(bytesOwner, 1, MAX_MEDIA_STORAGE_BYTES_PER_COMPANY - 4 * 100 * 1024 * 1024 - 1);
    const big = await queuedJob(bytesOwner);
    assert.equal(await runGenerationJob(bytesOwner.companyId, big), "failed");
    assert.deepEqual([(await jobRow(big)).lastError, await storedFiles(bytesOwner.companyId)], ["library_full", []]);
  });

  await check("generation jobs: no prompt, address of the service or file key reaches the logs; a failure logs its code", async () => {
    const owner = sessionFor(await signUpTestOwner("media-logs"));
    const service = fakeProvider({ start: { status: "done", output: { url: `https://images.fake-service.test/secret-${runId}.png` }, costCents: null } });
    const fetcher = fakeFetcher([new Response("nope", { status: 500 })]);
    const after = collectingAfter();
    const { logs } = await captureConsole(async () => {
      const result = await requestGenerationForSession(owner, { kind: "image", prompt: `Private prompt ${runId}` }, after.run, { mode: service.mode, fetcher: fetcher.fetcher });
      assert.ok(result.ok, messageOf(result));
      assert.deepEqual(await after.settle(), ["failed"]);
    });
    assert.deepEqual(logs, ["Media generation failed: download_failed"]);
    assert.ok(!logs.join("\n").includes(runId), "the prompt or the address was logged");
  });
}
