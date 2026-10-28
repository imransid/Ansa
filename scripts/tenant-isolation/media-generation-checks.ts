// Media generation checks (step 39): in development the stand-in makes a
// real PNG right after the answer, saved with its job and marked as made by
// it; it makes no video (an honest failure, never an asset); production
// without a real service is "off" and refuses the stand-in; prompts and the
// database's rules hold; the company's daily limit refuses before anything
// is saved; and nothing of the prompt reaches the logs. The stand-in only:
// nothing leaves this machine.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { colorOfPrompt, flatColorPng } from "@/adapters/dev-media-generator";
import { db } from "@/db/client";
import { mediaAssets, mediaGenerationJobs } from "@/db/schema";
import { parseEnv } from "@/lib/env";
import { describeGenerationError } from "@/lib/media/error-codes";
import { GENERATION_PROMPT_MAX_LENGTH } from "@/lib/media/limits";
import { mediaGenerationModeFor, providerForJob } from "@/lib/media-generation";
import { findProductionSettingProblems } from "@/lib/production-warnings";
import { GENERATION_OFF_MESSAGE, listGenerationJobsForSession, requestGenerationForSession } from "@/services/media-generation-jobs";
import { runGenerationJob } from "@/services/media-generation-runs";
import { listMediaForSession } from "@/services/media-library";
import { isOverRateLimit, RATE_LIMITS } from "@/services/rate-limit";
import { messageOf } from "./cofounder-helpers";
import { addTeammate, assertRefusedByConstraint, captureConsole, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { assetRow, collectingAfter, fakeProvider, jobRow, neverRun } from "./media-helpers";

// The fewest settings lib/env.ts accepts, all made up.
function validSettings(): Record<string, string> {
  return {
    DATABASE_URL: "postgres://x@localhost/x",
    BETTER_AUTH_SECRET: "s".repeat(32),
    BETTER_AUTH_URL: "http://localhost:3000",
    DATA_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
    VAPI_WEBHOOK_SECRET: "v".repeat(32),
  };
}

async function jobCount(companyId: string): Promise<number> {
  return (await db.select({ id: mediaGenerationJobs.id }).from(mediaGenerationJobs).where(eq(mediaGenerationJobs.companyId, companyId))).length;
}

async function assetCount(companyId: string): Promise<number> {
  return (await db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.companyId, companyId))).length;
}

export async function runMediaGenerationChecks() {
  await check("media generation: in development the stand-in makes the image after the answer: a real PNG under the company's folder, marked as the stand-in's, its job succeeded and linked, free", async () => {
    const owner = sessionFor(await signUpTestOwner("media-gen"));
    const prompt = `Fresh loaves on a wooden counter ${runId}`;
    const after = collectingAfter();
    const result = await requestGenerationForSession(owner, { kind: "image", prompt }, after.run);
    assert.ok(result.ok, messageOf(result));
    // Saved first, made after the answer.
    assert.deepEqual([(await jobRow(result.jobId)).status, after.tasks.length], ["queued", 1]);
    assert.deepEqual(await after.settle(), ["succeeded"]);
    const job = await jobRow(result.jobId);
    assert.deepEqual([job.status, job.attempts, job.costCents, job.lastError, job.provider, job.prompt], ["succeeded", 1, 0, null, "dev-stand-in", prompt]);
    assert.ok(job.assetId && job.finishedAt && job.startedAt);
    const asset = await assetRow(job.assetId);
    assert.deepEqual(
      [asset.source, asset.provider, asset.generationJobId, asset.createdByUserId, asset.contentType, asset.width, asset.height, asset.originalName, asset.altText],
      ["generated", "dev-stand-in", job.id, owner.userId, "image/png", 1024, 1024, null, ""],
    );
    assert.equal(asset.storageKey, `media/${owner.companyId}/${asset.id}.png`);
    const stored = await readFile(path.join(process.cwd(), ".dev-files", asset.storageKey));
    assert.ok(stored.equals(flatColorPng(colorOfPrompt(prompt))), "the stored file is not the stand-in's image");
    const [listed] = await listMediaForSession(owner, 1);
    assert.deepEqual([listed.id, listed.prompt, listed.source], [asset.id, prompt, "generated"]);
    const [shownJob] = await listGenerationJobsForSession(owner);
    assert.deepEqual([shownJob.status, shownJob.assetId, shownJob.isStuck], ["succeeded", asset.id, false]);
  });

  await check("media generation: the stand-in makes no video: the job fails with 'no_video_provider', in plain words, and never has an asset", async () => {
    const owner = sessionFor(await signUpTestOwner("media-gen-video"));
    const after = collectingAfter();
    const result = await requestGenerationForSession(owner, { kind: "video", prompt: "A baker shaping dough" }, after.run);
    assert.ok(result.ok, messageOf(result));
    const { result: outcomes, logs } = await captureConsole(() => after.settle());
    assert.deepEqual(outcomes, ["failed"]);
    const job = await jobRow(result.jobId);
    assert.deepEqual([job.status, job.lastError, job.assetId, job.assetDeletedAt], ["failed", "no_video_provider", null, null]);
    assert.ok(job.finishedAt);
    assert.equal(await assetCount(owner.companyId), 0);
    assert.match(describeGenerationError("no_video_provider"), /makes images only, so no video was made/);
    assert.deepEqual(logs, ["Media generation failed: no_video_provider"]);
    assert.ok(!logs.join("\n").includes("shaping dough"), "the prompt was logged");
  });

  await check("media generation: production without a real service is off (no job is made), the stand-in is refused there even when named, and a stand-in's job is never run by it", async () => {
    assert.deepEqual(mediaGenerationModeFor(undefined, "production"), { kind: "off" });
    assert.deepEqual(mediaGenerationModeFor("dev-stand-in", "production"), { kind: "off" });
    const development = mediaGenerationModeFor(undefined, "development");
    assert.ok(development.kind === "on" && development.provider.name === "dev-stand-in" && development.provider.isStandIn);
    assert.equal(mediaGenerationModeFor("dev-stand-in", undefined).kind, "on");
    assert.equal(providerForJob("dev-stand-in", { kind: "off" }), null);
    assert.equal(providerForJob("dev-stand-in", fakeProvider({ start: { status: "failed", code: "provider_failed" } }).mode), null);
    // The page's request: refused, and nothing is saved or run.
    const owner = sessionFor(await signUpTestOwner("media-gen-off"));
    const after = collectingAfter();
    const refused = await requestGenerationForSession(owner, { kind: "image", prompt: "Bread" }, after.run, { mode: { kind: "off" } });
    assert.equal(messageOf(refused), GENERATION_OFF_MESSAGE);
    assert.deepEqual([await jobCount(owner.companyId), after.tasks.length], [0, 0]);
    // A job asked of the stand-in, run by a server where it is refused, fails without an asset.
    const made = await requestGenerationForSession(owner, { kind: "image", prompt: "Bread" }, neverRun);
    assert.ok(made.ok, messageOf(made));
    assert.equal(await runGenerationJob(owner.companyId, made.jobId, { mode: { kind: "off" } }), "failed");
    assert.deepEqual([(await jobRow(made.jobId)).lastError, await assetCount(owner.companyId)], ["provider_unavailable", 0]);
    // Startup: a missing or refused service is named; a wrong value stops the server.
    const problems = (extra: Record<string, string>) => findProductionSettingProblems(parseEnv({ ...validSettings(), ...extra })).join("\n");
    assert.match(problems({}), /MEDIA_PROVIDER is not set: image generation is off/);
    assert.match(problems({ MEDIA_PROVIDER: "dev-stand-in" }), /MEDIA_PROVIDER is the development stand-in, which production refuses/);
    assert.throws(() => parseEnv({ ...validSettings(), MEDIA_PROVIDER: "some-vendor" }), /MEDIA_PROVIDER/);
  });

  await check("media generation: a prompt is 1-2,000 characters, a line break counting once; control characters and an unknown kind are refused before anything is saved", async () => {
    const owner = sessionFor(await signUpTestOwner("media-gen-prompt"));
    const refusals: [Record<string, unknown>, string, RegExp][] = [
      [{ kind: "image", prompt: "   " }, "prompt", /Say what the picture should show/],
      [{ kind: "image", prompt: "x".repeat(GENERATION_PROMPT_MAX_LENGTH + 1) }, "prompt", /at most 2,000 characters/],
      [{ kind: "image", prompt: "Bread\u0007" }, "prompt", /control characters/],
      [{ kind: "image", prompt: `a${"\u0301".repeat(31)}` }, "prompt", /accents or other marks/],
      [{ kind: "gif", prompt: "Bread" }, "kind", /Pick an image or a video/],
      [{ prompt: "Bread" }, "kind", /Pick an image or a video/],
    ];
    for (const [input, field, expected] of refusals) {
      const result = await requestGenerationForSession(owner, input, neverRun);
      assert.ok(!result.ok && expected.test(result.errors.fieldErrors?.[field]?.[0] ?? ""), `${JSON.stringify(input).slice(0, 60)}: ${JSON.stringify(result)}`);
    }
    assert.equal(await jobCount(owner.companyId), 0);
    // 2,000 characters once the line break is one, as the box counts it.
    const longest = `${"a".repeat(1000)}\r\n${"b".repeat(999)}`;
    const accepted = await requestGenerationForSession(owner, { kind: "image", prompt: longest }, neverRun);
    assert.ok(accepted.ok, messageOf(accepted));
    assert.equal((await jobRow(accepted.jobId)).prompt, `${"a".repeat(1000)}\n${"b".repeat(999)}`);
  });

  await check("media generation: Postgres refuses a job that failed without a code or with a message, an asset on an unfinished or failed job, a success without one, and a person, draft or asset of another company", async () => {
    const ownerA = sessionFor(await signUpTestOwner("media-gen-db-a"));
    const ownerB = sessionFor(await signUpTestOwner("media-gen-db-b"));
    const row = { companyId: ownerA.companyId, kind: "image" as const, prompt: "Bread", provider: "dev-stand-in", requestedByUserId: ownerA.userId };
    const finished = { finishedAt: new Date(), startedAt: new Date(), attempts: 1 };
    await assertRefusedByConstraint(db.insert(mediaGenerationJobs).values({ ...row, prompt: "" }), "media_generation_jobs_prompt_length");
    await assertRefusedByConstraint(db.insert(mediaGenerationJobs).values({ ...row, ...finished, status: "failed" }), "media_generation_jobs_failed_has_error");
    await assertRefusedByConstraint(
      db.insert(mediaGenerationJobs).values({ ...row, ...finished, status: "failed", lastError: "The service said: Bread is not allowed" }),
      "media_generation_jobs_last_error_is_code",
    );
    await assertRefusedByConstraint(db.insert(mediaGenerationJobs).values({ ...row, ...finished, status: "succeeded" }), "media_generation_jobs_succeeded_has_asset");
    await assertRefusedByConstraint(db.insert(mediaGenerationJobs).values({ ...row, attempts: 1 }), "media_generation_jobs_queued_not_started");
    await assertRefusedByConstraint(db.insert(mediaGenerationJobs).values({ ...row, status: "running", attempts: 1 }), "media_generation_jobs_running_has_start");
    await assertRefusedByConstraint(db.insert(mediaGenerationJobs).values({ ...row, status: "canceled" }), "media_generation_jobs_finished_has_end");
    await assertRefusedByConstraint(db.insert(mediaGenerationJobs).values({ ...row, requestedByUserId: ownerB.userId }), "media_generation_jobs_requester_in_same_company_fk");
    await assertRefusedByConstraint(db.insert(mediaGenerationJobs).values({ ...row, draftId: randomUUID(), draftVersion: 1 }), "media_generation_jobs_draft_in_same_company_fk");
    // A failed job never has an asset, even one of its own company.
    const after = collectingAfter();
    const made = await requestGenerationForSession(ownerA, { kind: "image", prompt: "Bread" }, after.run);
    assert.ok(made.ok, messageOf(made));
    await after.settle();
    const assetId = (await jobRow(made.jobId)).assetId;
    await assertRefusedByConstraint(
      db.insert(mediaGenerationJobs).values({ ...row, ...finished, status: "failed", lastError: "provider_failed", assetId }),
      "media_generation_jobs_asset_only_when_succeeded",
    );
    await assertRefusedByConstraint(
      db.update(mediaGenerationJobs).set({ status: "running", finishedAt: null }).where(eq(mediaGenerationJobs.id, made.jobId)),
      "media_generation_jobs_asset_only_when_succeeded",
    );
    // B's job can't point at A's asset.
    const rowB = { ...row, companyId: ownerB.companyId, requestedByUserId: ownerB.userId };
    await assertRefusedByConstraint(db.insert(mediaGenerationJobs).values({ ...rowB, ...finished, status: "succeeded", assetId }), "media_generation_jobs_asset_in_same_company_fk");
  });

  await check("media generation: the company's daily limit refuses before anything is saved or run, for everyone in it; another company still asks", async () => {
    const ownerUser = await signUpTestOwner("media-gen-limit");
    const owner = sessionFor(ownerUser);
    for (let request = 0; request < RATE_LIMITS.mediaGenerationsPerCompany.maxAttempts; request++) {
      await isOverRateLimit("media-generations", owner.companyId, RATE_LIMITS.mediaGenerationsPerCompany);
    }
    const after = collectingAfter();
    assert.match(messageOf(await requestGenerationForSession(owner, { kind: "image", prompt: "Bread" }, after.run)), /limit of 30 images and videos a day/);
    const member = sessionFor(await addTeammate(ownerUser, "media-gen-limit-mate", "member"));
    assert.match(messageOf(await requestGenerationForSession(member, { kind: "image", prompt: "Bread" }, after.run)), /limit of 30/);
    assert.deepEqual([await jobCount(owner.companyId), after.tasks.length], [0, 0]);
    const other = sessionFor(await signUpTestOwner("media-gen-limit-other"));
    assert.ok((await requestGenerationForSession(other, { kind: "image", prompt: "Bread" }, neverRun)).ok);
  });
}
