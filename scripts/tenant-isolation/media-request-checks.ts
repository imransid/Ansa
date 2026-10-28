// Media request checks (step 39 review): an image asked from a draft is
// attached only while the draft is at the version it was asked at; a draft
// has one request at a time (a new one over a stuck one ends it, so it
// never runs); "Start now" claims the request before the page answers, so
// the page shows it being made; a failed request says why on the draft's
// page; and every link to an image names the library page that shows it.
// The stand-in, and FAKE image services only.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { createGenerationJob } from "@/db/media-generation-requests";
import { mediaGenerationJobs } from "@/db/schema";
import { describeGenerationError } from "@/lib/media/error-codes";
import { mediaLibraryLink } from "@/lib/media/library-link";
import type { SessionContext } from "@/lib/session";
import { getContentDraftPageForSession } from "@/services/content-drafts";
import { startStuckGenerationForSession } from "@/services/media-generation-control";
import { listGenerationJobsForSession, requestDraftImageForSession, requestGenerationForSession } from "@/services/media-generation-jobs";
import { runGenerationJob } from "@/services/media-generation-runs";
import { getLibraryPagesOfAssets, listMediaForSession } from "@/services/media-library";
import { messageOf } from "./cofounder-helpers";
import { approveDraft, draftRow, editDraft } from "./content-studio-helpers";
import { assertRefusedByConstraint, captureConsole, check, sessionFor, signUpTestOwner } from "./helpers";
import { attachToDraft, imagePostDraft } from "./media-draft-checks";
import { assetRow, collectingAfter, fakeProvider, jobRow, neverRun, PNG, pretendStored, uploadedAssetId } from "./media-helpers";

// Asks for the draft's image at its version now, as its page does, without running it: the job's id.
async function askedForDraft(session: SessionContext, draftId: string): Promise<string> {
  const result = await requestDraftImageForSession(session, { draftId, version: String((await draftRow(draftId)).version) }, neverRun);
  assert.ok(result.ok, messageOf(result));
  return result.jobId;
}

// The run that should have started it right after the answer was lost.
async function makeStuck(jobId: string): Promise<void> {
  await db.update(mediaGenerationJobs).set({ createdAt: new Date(Date.now() - 3 * 60_000) }).where(eq(mediaGenerationJobs.id, jobId));
}

async function panelOf(session: SessionContext, draftId: string) {
  const page = await getContentDraftPageForSession(session, draftId);
  assert.ok(page, "no draft page");
  return page.media;
}

export async function runMediaRequestChecks() {
  await check("draft media: an image is attached only while the draft is at the version it was asked at: a stuck request run after an edit, another image and an approval leaves the draft alone and keeps the image in the library", async () => {
    const owner = sessionFor(await signUpTestOwner("media-request-version"));
    const draftId = await imagePostDraft(owner);
    const jobId = await askedForDraft(owner, draftId);
    assert.equal((await jobRow(jobId)).draftVersion, 2);
    await makeStuck(jobId);
    // Meanwhile, in another tab: an edit, an image from the library, an approval.
    assert.deepEqual(await editDraft(owner, draftId, { body: "Baked at dawn." }), { ok: true });
    assert.deepEqual(await attachToDraft(owner, draftId, await uploadedAssetId(owner, PNG, "chosen.png")), { ok: true });
    assert.deepEqual(await approveDraft(owner, draftId, true), { ok: true });
    const { openJob } = await panelOf(owner, draftId);
    assert.deepEqual([openJob?.isStuck, openJob?.forThisVersion], [true, false]);
    const before = await draftRow(draftId);
    // The daily job runs it later.
    assert.equal(await runGenerationJob(owner.companyId, jobId), "succeeded");
    assert.deepEqual(await draftRow(draftId), before);
    const made = (await jobRow(jobId)).assetId;
    assert.ok(made && (await assetRow(made)), "the image was not kept in the library");
  });

  await check("draft media: one request per draft at a time: four at the same moment make one (the others hear it is being made), Postgres refuses a second open one, and a new request over a stuck one ends it as superseded, so it never runs", async () => {
    const owner = sessionFor(await signUpTestOwner("media-request-one"));
    const draftId = await imagePostDraft(owner);
    const job = { kind: "image" as const, prompt: "Three loaves", provider: "dev-stand-in", draft: { id: draftId, version: 2 } };
    const outcomes = await Promise.all(Array.from({ length: 4 }, () => createGenerationJob(owner.companyId, owner.userId, job)));
    const created = outcomes.flatMap((outcome) => (outcome.outcome === "created" ? [outcome.jobId] : []));
    assert.deepEqual([created.length, outcomes.filter((outcome) => outcome.outcome === "draft-busy").length], [1, 3]);
    assert.match(messageOf(await requestDraftImageForSession(owner, { draftId, version: "2" }, neverRun)), /already being made/);
    assert.deepEqual(await createGenerationJob(owner.companyId, owner.userId, { ...job, draft: { id: draftId, version: 1 } }), { outcome: "draft-stale" });
    const row = { companyId: owner.companyId, kind: "image" as const, prompt: "x", provider: "dev-stand-in", requestedByUserId: owner.userId };
    await assertRefusedByConstraint(db.insert(mediaGenerationJobs).values({ ...row, draftId, draftVersion: 2 }), "media_generation_jobs_one_open_per_draft");
    await assertRefusedByConstraint(db.insert(mediaGenerationJobs).values({ ...row, draftId }), "media_generation_jobs_draft_version_with_draft");
    await makeStuck(created[0]);
    const after = collectingAfter();
    const replacement = await requestDraftImageForSession(owner, { draftId, version: "2" }, after.run);
    assert.ok(replacement.ok, messageOf(replacement));
    const old = await jobRow(created[0]);
    assert.deepEqual([old.status, old.lastError, old.assetId], ["failed", "superseded", null]);
    assert.ok(old.finishedAt);
    assert.equal(await runGenerationJob(owner.companyId, created[0]), "not-claimed");
    assert.deepEqual(await after.settle(), ["succeeded"]);
    assert.equal((await draftRow(draftId)).mediaAssetId, (await jobRow(replacement.jobId)).assetId);
  });

  await check("generation jobs: 'Start now' claims the request before the page answers, so the page sent back shows it being made, not stuck (it refreshes itself; the draft's editor waits); one cut off 3 times is ended instead, asking nothing", async () => {
    const owner = sessionFor(await signUpTestOwner("media-request-start"));
    const draftId = await imagePostDraft(owner);
    const jobId = await askedForDraft(owner, draftId);
    await makeStuck(jobId);
    assert.equal((await panelOf(owner, draftId)).openJob?.isStuck, true);
    const after = collectingAfter();
    assert.deepEqual(await startStuckGenerationForSession(owner, { jobId }, after.run), { ok: true });
    // What the action's page is rendered from, before after() runs:
    const { openJob } = await panelOf(owner, draftId);
    assert.deepEqual([openJob?.status, openJob?.isStuck, openJob?.forThisVersion, after.tasks.length], ["running", false, true, 1]);
    const [listed] = await listGenerationJobsForSession(owner);
    assert.deepEqual([listed.id, listed.status, listed.isStuck], [jobId, "running", false]);
    assert.deepEqual(await after.settle(), ["succeeded"]);
    assert.equal((await draftRow(draftId)).mediaAssetId, (await jobRow(jobId)).assetId);
    const worn = await requestGenerationForSession(owner, { kind: "image", prompt: "Worn out" }, neverRun);
    assert.ok(worn.ok, messageOf(worn));
    await db
      .update(mediaGenerationJobs)
      .set({ status: "running", attempts: 3, startedAt: new Date(Date.now() - 16 * 60_000) })
      .where(eq(mediaGenerationJobs.id, worn.jobId));
    const later = collectingAfter();
    assert.deepEqual(await startStuckGenerationForSession(owner, { jobId: worn.jobId }, later.run), { ok: true });
    assert.deepEqual([(await jobRow(worn.jobId)).lastError, later.tasks.length], ["interrupted", 0]);
  });

  await check("draft media: a request for the version on screen that failed says why on the draft's page (not while a new one is being made); a later change of the draft hides it", async () => {
    const owner = sessionFor(await signUpTestOwner("media-request-failed"));
    const draftId = await imagePostDraft(owner);
    const refusing = fakeProvider({ start: { status: "failed", code: "provider_refused" } });
    const after = collectingAfter();
    const asked = await requestDraftImageForSession(owner, { draftId, version: "2" }, after.run, { mode: refusing.mode });
    assert.ok(asked.ok, messageOf(asked));
    assert.deepEqual((await captureConsole(() => after.settle())).result, ["failed"]);
    const failed = await panelOf(owner, draftId);
    assert.deepEqual([failed.openJob, failed.lastFailure], [null, { code: "provider_refused" }]);
    assert.match(describeGenerationError("provider_refused"), /refused this prompt/);
    const again = await askedForDraft(owner, draftId);
    const asking = await panelOf(owner, draftId);
    assert.deepEqual([asking.openJob?.id, asking.lastFailure], [again, null]);
    await db.update(mediaGenerationJobs).set({ status: "failed", lastError: "provider_failed", finishedAt: new Date() }).where(eq(mediaGenerationJobs.id, again));
    assert.deepEqual((await panelOf(owner, draftId)).lastFailure, { code: "provider_failed" });
    assert.deepEqual(await editDraft(owner, draftId, { body: "Baked at dawn." }), { ok: true });
    assert.equal((await panelOf(owner, draftId)).lastFailure, null);
  });

  await check("media library: a link to an image names the library page that shows it (50 to a page, newest first): the draft's 'Edit it in the media library' and the requests' 'See it in the library'; another company finds no page", async () => {
    const owner = sessionFor(await signUpTestOwner("media-request-pages"));
    const other = sessionFor(await signUpTestOwner("media-request-pages-other"));
    const after = collectingAfter();
    const made = await requestGenerationForSession(owner, { kind: "image", prompt: "Croissants" }, after.run);
    assert.ok(made.ok, messageOf(made));
    await after.settle();
    const assetId = (await jobRow(made.jobId)).assetId;
    assert.ok(assetId);
    const draftId = await imagePostDraft(owner);
    assert.deepEqual(await attachToDraft(owner, draftId, assetId), { ok: true });
    assert.equal((await panelOf(owner, draftId)).attachedLibraryPage, 1);
    // 60 newer files push it to the second page.
    await pretendStored(owner, 60, 10);
    assert.equal((await panelOf(owner, draftId)).attachedLibraryPage, 2);
    assert.ok((await listMediaForSession(owner, 2)).some((asset) => asset.id === assetId), "it isn't on the page the link names");
    const [listedJob] = await listGenerationJobsForSession(owner);
    assert.deepEqual([listedJob.id, listedJob.libraryPage], [made.jobId, 2]);
    assert.deepEqual([mediaLibraryLink(assetId, 2), mediaLibraryLink(assetId, 1)], [`/cofounder/media?page=2#asset-${assetId}`, `/cofounder/media#asset-${assetId}`]);
    assert.deepEqual(await getLibraryPagesOfAssets(other.companyId, [assetId]), new Map());
  });
}
