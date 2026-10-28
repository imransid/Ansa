import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { EDITABLE_STATUSES, mediaKindOfFormat } from "@/lib/content-studio/draft-fields";
import type { MediaKind } from "@/lib/media/kinds";
import { db, type DbTransaction } from "./client";
import { lockDraft } from "./content-draft-rows";
import { lockActiveAuthorRole } from "./knowledge-author";
import { isStuckJob } from "./media-generation-jobs";
import { mediaGenerationJobs } from "./schema";

// Saving one company's image and video requests (step 39): from the media
// page, or from a draft (its result is attached to that draft). Reading,
// canceling and running them: db/media-generation-jobs.ts and
// db/media-generation-runs.ts.

// draft: the draft to attach the result to, at the version the page showed.
export type NewGenerationJob = { kind: MediaKind; prompt: string; provider: string; draft: { id: string; version: number } | null };

// "draft-stale": the draft changed since the page showed it. "draft-busy":
// an image for it is already waiting or being made (and isn't stuck).
export type CreateJobOutcome =
  | { outcome: "created"; jobId: string }
  | { outcome: "not-allowed" | "draft-not-found" | "draft-wrong-format" | "draft-not-editable" | "draft-stale" | "draft-busy" };

type DraftRefusal = Exclude<CreateJobOutcome["outcome"], "created" | "not-allowed">;

// Saves a request of one company, by actorUserId while active in it. A
// draft to attach the result to must be the company's, editable, of the
// format that takes this kind and at the version the page showed (checked
// again when the result is saved). Lock order: the person, the draft, its
// requests (as when a result is saved, db/media-generation-runs.ts).
export async function createGenerationJob(companyId: string, actorUserId: string, job: NewGenerationJob): Promise<CreateJobOutcome> {
  return db.transaction(async (tx) => {
    if (!(await lockActiveAuthorRole(tx, companyId, actorUserId))) {
      return { outcome: "not-allowed" };
    }
    const refusal = job.draft ? await prepareDraftForRequest(tx, companyId, job.draft, job.kind) : null;
    if (refusal) {
      return { outcome: refusal };
    }
    // Every column named: the status, attempts and asset start as the database sets them.
    const [created] = await tx
      .insert(mediaGenerationJobs)
      .values({
        companyId,
        kind: job.kind,
        prompt: job.prompt,
        provider: job.provider,
        draftId: job.draft?.id ?? null,
        draftVersion: job.draft?.version ?? null,
        requestedByUserId: actorUserId,
      })
      .returning({ id: mediaGenerationJobs.id });
    return { outcome: "created", jobId: created.id };
  });
}

// Locks the draft a request is for and checks it takes one now, or why
// not. A stuck request of the same draft (its run was lost) is ended as
// "superseded" first, so it can never attach an older image later, nor be
// paid for. WHY the draft's row is locked: two requests at the same moment
// wait for each other here, so a draft never has two open ones (a unique
// index says so too, db/schema/media.ts).
async function prepareDraftForRequest(
  tx: DbTransaction,
  companyId: string,
  draft: { id: string; version: number },
  kind: MediaKind,
): Promise<DraftRefusal | null> {
  const current = await lockDraft(tx, companyId, draft.id);
  if (!current) {
    return "draft-not-found";
  }
  if (mediaKindOfFormat(current.format) !== kind) {
    return "draft-wrong-format";
  }
  if (!EDITABLE_STATUSES.includes(current.status)) {
    return "draft-not-editable";
  }
  if (current.version !== draft.version) {
    return "draft-stale";
  }
  const open = await tx
    .select({ id: mediaGenerationJobs.id, isStuck: sql<boolean>`${isStuckJob()}`.mapWith(Boolean) })
    .from(mediaGenerationJobs)
    .where(and(eq(mediaGenerationJobs.companyId, companyId), eq(mediaGenerationJobs.draftId, draft.id), inArray(mediaGenerationJobs.status, ["queued", "running"])))
    .for("update");
  if (open.some((job) => !job.isStuck)) {
    return "draft-busy";
  }
  if (open.length > 0) {
    await tx
      .update(mediaGenerationJobs)
      .set({ status: "failed", lastError: "superseded", finishedAt: sql`now()` })
      .where(and(eq(mediaGenerationJobs.companyId, companyId), inArray(mediaGenerationJobs.id, open.map((job) => job.id))));
  }
  return null;
}
