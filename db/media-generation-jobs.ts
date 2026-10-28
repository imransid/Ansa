import "server-only";
import { and, count, desc, eq, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import type { MediaGenerationJobStatus, MediaKind } from "@/lib/media/kinds";
import { QUEUED_GENERATION_STUCK_MINUTES, STALE_GENERATION_MINUTES } from "@/lib/media/limits";
import { db } from "./client";
import { lockActiveAuthorRole } from "./knowledge-author";
import { contentDrafts, mediaAssets, mediaGenerationJobs, users } from "./schema";

// One company's image and video requests (step 39): the list, the open one
// of a draft and the newest at its version, how many are open, and
// canceling one still waiting. Making one: db/media-generation-requests.ts;
// running them: db/media-generation-runs.ts. Anyone active in the company:
// the role is read again, locked, in each transaction (db/knowledge-author.ts
// says why).

export type GenerationJobListItem = {
  id: string;
  kind: MediaKind;
  prompt: string;
  provider: string;
  status: MediaGenerationJobStatus;
  attempts: number;
  lastError: string | null;
  costCents: number | null;
  // What it made, while that asset exists; when it was deleted since.
  assetId: string | null;
  assetDeletedAt: Date | null;
  draftId: string | null;
  draftTopic: string | null;
  // What that draft has attached now: this job's asset, or something else.
  draftMediaAssetId: string | null;
  requestedByName: string | null;
  createdAt: Date;
  finishedAt: Date | null;
  // Waiting or being made for so long that its run was surely cut off:
  // anyone may start it again (a claim still decides who runs it).
  isStuck: boolean;
};

// A draft's request still waiting or being made. draftVersion: the version
// it was asked at (its image is attached only while the draft is at it).
export type OpenDraftJob = { id: string; status: MediaGenerationJobStatus; createdAt: Date; draftVersion: number | null; isStuck: boolean };

// The newest requests of one company, with who asked, the draft they are
// for and whether what they made still exists. Every join matches company_id.
export async function getGenerationJobsForCompany(companyId: string, limit: number): Promise<GenerationJobListItem[]> {
  return db
    .select({
      id: mediaGenerationJobs.id,
      kind: mediaGenerationJobs.kind,
      prompt: mediaGenerationJobs.prompt,
      provider: mediaGenerationJobs.provider,
      status: mediaGenerationJobs.status,
      attempts: mediaGenerationJobs.attempts,
      lastError: mediaGenerationJobs.lastError,
      costCents: mediaGenerationJobs.costCents,
      assetId: mediaAssets.id,
      assetDeletedAt: mediaGenerationJobs.assetDeletedAt,
      draftId: mediaGenerationJobs.draftId,
      draftTopic: contentDrafts.topic,
      draftMediaAssetId: contentDrafts.mediaAssetId,
      requestedByName: users.name,
      createdAt: mediaGenerationJobs.createdAt,
      finishedAt: mediaGenerationJobs.finishedAt,
      isStuck: sql<boolean>`${isStuckJob()}`.mapWith(Boolean),
    })
    .from(mediaGenerationJobs)
    .leftJoin(users, and(eq(users.id, mediaGenerationJobs.requestedByUserId), eq(users.companyId, mediaGenerationJobs.companyId)))
    .leftJoin(contentDrafts, and(eq(contentDrafts.id, mediaGenerationJobs.draftId), eq(contentDrafts.companyId, mediaGenerationJobs.companyId)))
    .leftJoin(mediaAssets, and(eq(mediaAssets.id, mediaGenerationJobs.assetId), eq(mediaAssets.companyId, mediaGenerationJobs.companyId)))
    .where(eq(mediaGenerationJobs.companyId, companyId))
    .orderBy(desc(mediaGenerationJobs.createdAt), desc(mediaGenerationJobs.id))
    .limit(limit);
}

// The request of one company's draft still waiting or being made (there is
// at most one, db/media-generation-requests.ts), or undefined: its page
// shows it, and the editor waits for it.
export async function getOpenGenerationJobForDraft(companyId: string, draftId: string): Promise<OpenDraftJob | undefined> {
  const [job] = await db
    .select({
      id: mediaGenerationJobs.id,
      status: mediaGenerationJobs.status,
      createdAt: mediaGenerationJobs.createdAt,
      draftVersion: mediaGenerationJobs.draftVersion,
      isStuck: sql<boolean>`${isStuckJob()}`.mapWith(Boolean),
    })
    .from(mediaGenerationJobs)
    .where(
      and(
        eq(mediaGenerationJobs.companyId, companyId),
        eq(mediaGenerationJobs.draftId, draftId),
        inArray(mediaGenerationJobs.status, ["queued", "running"]),
      ),
    )
    .orderBy(desc(mediaGenerationJobs.createdAt))
    .limit(1);
  return job;
}

// The newest request of one company's draft made at this version of it,
// how it stands and why it failed, or undefined: the draft's page says when
// the image asked for the version on screen wasn't made.
export async function getNewestGenerationJobAtVersion(
  companyId: string,
  draftId: string,
  draftVersion: number,
): Promise<{ status: MediaGenerationJobStatus; lastError: string | null } | undefined> {
  const [job] = await db
    .select({ status: mediaGenerationJobs.status, lastError: mediaGenerationJobs.lastError })
    .from(mediaGenerationJobs)
    .where(and(eq(mediaGenerationJobs.companyId, companyId), eq(mediaGenerationJobs.draftId, draftId), eq(mediaGenerationJobs.draftVersion, draftVersion)))
    .orderBy(desc(mediaGenerationJobs.createdAt), desc(mediaGenerationJobs.id))
    .limit(1);
  return job;
}

// How many of one company's requests are waiting or being made: each will
// be a file of its library (the cap counts them, services/media-library.ts).
export async function countOpenGenerationJobs(companyId: string): Promise<number> {
  const [open] = await db
    .select({ count: count() })
    .from(mediaGenerationJobs)
    .where(and(eq(mediaGenerationJobs.companyId, companyId), inArray(mediaGenerationJobs.status, ["queued", "running"])));
  return open?.count ?? 0;
}

// Whether one request of one company is stuck (see isStuck above), or
// undefined for an unknown one.
export async function isGenerationJobStuck(companyId: string, jobId: string): Promise<boolean | undefined> {
  const [job] = await db
    .select({ isStuck: sql<boolean>`${isStuckJob()}`.mapWith(Boolean) })
    .from(mediaGenerationJobs)
    .where(and(eq(mediaGenerationJobs.companyId, companyId), eq(mediaGenerationJobs.id, jobId)));
  return job?.isStuck;
}

// Cancels one request of one company, only while it waits to start: once a
// run claimed it, the service may already be making (and charging for) it.
export async function cancelGenerationJob(companyId: string, actorUserId: string, jobId: string): Promise<"canceled" | "not-found" | "not-allowed" | "wrong-status"> {
  return db.transaction(async (tx) => {
    if (!(await lockActiveAuthorRole(tx, companyId, actorUserId))) {
      return "not-allowed";
    }
    const byId = and(eq(mediaGenerationJobs.companyId, companyId), eq(mediaGenerationJobs.id, jobId));
    const [canceled] = await tx
      .update(mediaGenerationJobs)
      .set({ status: "canceled", finishedAt: sql`now()` })
      .where(and(byId, eq(mediaGenerationJobs.status, "queued")))
      .returning({ id: mediaGenerationJobs.id });
    if (canceled) {
      return "canceled";
    }
    const [exists] = await tx.select({ id: mediaGenerationJobs.id }).from(mediaGenerationJobs).where(byId);
    return exists ? "wrong-status" : "not-found";
  });
}

// Waiting longer than a run takes to start, or being made longer than a run
// can last: by the database's clock, like the claim.
export function isStuckJob(): SQL {
  const stuck = or(
    and(eq(mediaGenerationJobs.status, "queued"), lt(mediaGenerationJobs.createdAt, minutesAgo(QUEUED_GENERATION_STUCK_MINUTES))),
    and(eq(mediaGenerationJobs.status, "running"), lt(mediaGenerationJobs.startedAt, minutesAgo(STALE_GENERATION_MINUTES))),
  );
  // A job never started has no start time: false, not null.
  return sql`coalesce(${stuck}, false)`;
}

export function minutesAgo(minutes: number) {
  return sql`now() - make_interval(mins => ${minutes})`;
}
