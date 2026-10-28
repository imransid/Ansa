import "server-only";
import { and, count, eq, gte, lt, or, sql } from "drizzle-orm";
import type { MediaContentType, MediaKind } from "@/lib/media/kinds";
import { MAX_GENERATION_ATTEMPTS, MAX_MEDIA_ASSETS_PER_COMPANY, MAX_MEDIA_STORAGE_BYTES_PER_COMPANY, STALE_GENERATION_MINUTES } from "@/lib/media/limits";
import { db, type DbTransaction } from "./client";
import { lockCompanyRow } from "./company-lock";
import { attachGeneratedMedia } from "./content-draft-media";
import { lockDraft } from "./content-draft-rows";
import { lockActiveAuthorRole } from "./knowledge-author";
import { minutesAgo } from "./media-generation-jobs";
import { mediaAssets, mediaGenerationJobs } from "./schema";

// Running one company's image and video requests (step 39,
// services/media-generation-runs.ts). A run first CLAIMS the job in one
// UPDATE, so two runs never both work it; every later write names the
// attempt it claimed, so a run that lost its claim (it was cut off and
// another took over) never overwrites what the newer run decides.

export type ClaimedGenerationJob = {
  kind: MediaKind;
  prompt: string;
  provider: string;
  // The service's id of a job an earlier run started: poll it, don't ask again.
  providerJobId: string | null;
  // This run's attempt (1, 2 or 3).
  attempt: number;
  // The draft to attach the result to, and the version it was asked at.
  draftId: string | null;
  draftVersion: number | null;
  requestedByUserId: string;
};

export type GeneratedAssetToSave = {
  assetId: string;
  storageKey: string;
  kind: MediaKind;
  contentType: MediaContentType;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  provider: string;
  costCents: number | null;
};

// Claims one job of one company for this run, in ONE UPDATE: one waiting
// to start, or one "being made" whose run started 15+ minutes ago and was
// tried fewer than 3 times. Undefined when it isn't this company's or is
// taken, finished or canceled.
export async function claimGenerationJob(companyId: string, jobId: string): Promise<ClaimedGenerationJob | undefined> {
  const [job] = await db
    .update(mediaGenerationJobs)
    .set({ status: "running", attempts: sql`${mediaGenerationJobs.attempts} + 1`, startedAt: sql`now()` })
    .where(
      and(
        eq(mediaGenerationJobs.companyId, companyId),
        eq(mediaGenerationJobs.id, jobId),
        or(eq(mediaGenerationJobs.status, "queued"), and(isRunStale(), lt(mediaGenerationJobs.attempts, MAX_GENERATION_ATTEMPTS))),
      ),
    )
    .returning({
      kind: mediaGenerationJobs.kind,
      prompt: mediaGenerationJobs.prompt,
      provider: mediaGenerationJobs.provider,
      providerJobId: mediaGenerationJobs.providerJobId,
      attempt: mediaGenerationJobs.attempts,
      draftId: mediaGenerationJobs.draftId,
      draftVersion: mediaGenerationJobs.draftVersion,
      requestedByUserId: mediaGenerationJobs.requestedByUserId,
    });
  return job;
}

// Ends one job of one company whose runs were all cut off: still "being
// made" 15+ minutes after its third run started. True when it did.
export async function giveUpInterruptedJob(companyId: string, jobId: string): Promise<boolean> {
  const ended = await db
    .update(mediaGenerationJobs)
    .set({ status: "failed", lastError: "interrupted", finishedAt: sql`now()` })
    .where(
      and(
        eq(mediaGenerationJobs.companyId, companyId),
        eq(mediaGenerationJobs.id, jobId),
        isRunStale(),
        gte(mediaGenerationJobs.attempts, MAX_GENERATION_ATTEMPTS),
      ),
    )
    .returning({ id: mediaGenerationJobs.id });
  return ended.length > 0;
}

// Keeps the service's own id of a job it runs in the background, while
// this run still holds the job: a later run polls it instead of asking
// (and paying) again.
export async function saveProviderJobId(companyId: string, jobId: string, attempt: number, providerJobId: string): Promise<void> {
  await db.update(mediaGenerationJobs).set({ providerJobId }).where(heldBy(companyId, jobId, attempt));
}

// Ends one job as failed with a code (never a message), if this run still
// holds it. Nothing is made: a failed job never has an asset.
export async function failGenerationJob(companyId: string, jobId: string, attempt: number, failure: { code: string; costCents: number | null }): Promise<boolean> {
  const ended = await db
    .update(mediaGenerationJobs)
    .set({ status: "failed", lastError: failure.code, costCents: failure.costCents, finishedAt: sql`now()` })
    .where(heldBy(companyId, jobId, attempt))
    .returning({ id: mediaGenerationJobs.id });
  return ended.length > 0;
}

// Saves what one job made (the file is already in storage), in ONE
// transaction: the asset, the job succeeded and linked to it, and, when it
// was asked from a draft that still takes it, the draft with it attached as
// its next version, without its approval. "lost-claim": another run holds
// the job now, and nothing was written. "library-full": the company's
// library has no room for it (300 files, 500 MB), so the job failed and no
// asset was written. Lock order, as everywhere: the company (its row lock
// FIRST, so two saves can't both pass the cap), the person, the draft, the job.
export async function saveGeneratedAsset(
  companyId: string,
  jobId: string,
  claimed: ClaimedGenerationJob,
  asset: GeneratedAssetToSave,
): Promise<"saved" | "lost-claim" | "library-full"> {
  return db.transaction(async (tx) => {
    await lockCompanyRow(tx, companyId);
    // Attached on behalf of whoever asked, only while they are still in the company.
    const requesterRole = claimed.draftId ? await lockActiveAuthorRole(tx, companyId, claimed.requestedByUserId) : null;
    const draft = claimed.draftId ? await lockDraft(tx, companyId, claimed.draftId) : undefined;
    const [job] = await tx.select({ id: mediaGenerationJobs.id }).from(mediaGenerationJobs).where(heldBy(companyId, jobId, claimed.attempt)).for("update");
    if (!job) {
      return "lost-claim";
    }
    if (await libraryHasNoRoomFor(tx, companyId, asset.sizeBytes)) {
      await tx
        .update(mediaGenerationJobs)
        .set({ status: "failed", lastError: "library_full", costCents: asset.costCents, finishedAt: sql`now()` })
        .where(heldBy(companyId, jobId, claimed.attempt));
      return "library-full";
    }
    // Every column named, never a spread of `asset`.
    await tx.insert(mediaAssets).values({
      id: asset.assetId,
      companyId,
      kind: asset.kind,
      source: "generated",
      contentType: asset.contentType,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      storageKey: asset.storageKey,
      generationJobId: jobId,
      provider: asset.provider,
      createdByUserId: claimed.requestedByUserId,
    });
    await tx
      .update(mediaGenerationJobs)
      .set({ status: "succeeded", assetId: asset.assetId, costCents: asset.costCents, finishedAt: sql`now()` })
      .where(heldBy(companyId, jobId, claimed.attempt));
    if (requesterRole && claimed.draftId && claimed.draftVersion !== null && draft) {
      const target = { draftId: claimed.draftId, draft, askedAtVersion: claimed.draftVersion, assetId: asset.assetId, kind: asset.kind };
      await attachGeneratedMedia(tx, companyId, claimed.requestedByUserId, target);
    }
    return "saved";
  });
}

// True when one more file of this size would take the company past its
// library's cap (lib/media/limits.ts), counted inside the transaction.
async function libraryHasNoRoomFor(tx: DbTransaction, companyId: string, sizeBytes: number): Promise<boolean> {
  const [stored] = await tx
    .select({
      count: count(),
      // sum() of integers comes back as a bigint, which the driver hands over as text.
      totalBytes: sql<number>`coalesce(sum(${mediaAssets.sizeBytes}), 0)`.mapWith(Number),
    })
    .from(mediaAssets)
    .where(eq(mediaAssets.companyId, companyId));
  return stored.count + 1 > MAX_MEDIA_ASSETS_PER_COMPANY || stored.totalBytes + sizeBytes > MAX_MEDIA_STORAGE_BYTES_PER_COMPANY;
}

// "Being made" by the run that claimed this attempt.
function heldBy(companyId: string, jobId: string, attempt: number) {
  return and(
    eq(mediaGenerationJobs.companyId, companyId),
    eq(mediaGenerationJobs.id, jobId),
    eq(mediaGenerationJobs.status, "running"),
    eq(mediaGenerationJobs.attempts, attempt),
  );
}

// "Being made" by a run that started 15+ minutes ago: it was cut off.
function isRunStale() {
  return and(eq(mediaGenerationJobs.status, "running"), lt(mediaGenerationJobs.startedAt, minutesAgo(STALE_GENERATION_MINUTES)));
}
