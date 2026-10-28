import "server-only";
import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "./client";
import { isStuckInboundEmail } from "./inbound-email-processing";
import { isStuckJob } from "./media-generation-jobs";
import { calls, inboundEmails, mediaGenerationJobs } from "./schema";

// The webhooks hand two jobs to after(), once they have answered: turning an
// email into a ticket, and analyzing a call; the Co-Founder's media page a
// third, making an image or video (step 39). A run that was cut off (a
// crash, a deploy, a time limit) leaves its row unfinished, and nothing
// sends it again. The scheduled job (services/stuck-work.ts) finds those
// rows here and runs them again.
//
// Not company-scoped on purpose: the job has no session and serves every
// company. It only reads ids; the work itself then runs through the normal
// company-scoped paths, each with the row's own company.

export type StuckItem = { companyId: string; id: string };

// A call this long after it was saved (never analyzed) or after its analysis
// started (never finished) is treated as stuck. Longer than the 5 minutes
// after which "Analyze now" may redo it by hand, so the job doesn't race a
// slow run.
const STUCK_CALL_MINUTES = 15;

// WHY least recently tried first, not oldest first: a row whose last run was
// cut off again (it keeps failing the same way) must go to the back, or it
// would come first in every run and block everything behind it.

// Received emails whose processing never finished, least recently tried
// first: by when the last run started, or when it arrived if none did.
export async function findStuckInboundEmails(limit: number): Promise<StuckItem[]> {
  return db
    .select({ companyId: inboundEmails.companyId, id: inboundEmails.id })
    .from(inboundEmails)
    .where(isStuckInboundEmail())
    .orderBy(asc(sql`coalesce(${inboundEmails.processingStartedAt}, ${inboundEmails.receivedAt})`))
    .limit(limit);
}

// Calls never analyzed, or whose analysis never finished, least recently
// tried first: by when the last analysis started, or when the call was saved.
export async function findStuckCalls(limit: number): Promise<StuckItem[]> {
  const stuckSince = sql`now() - make_interval(mins => ${STUCK_CALL_MINUTES})`;
  return db
    .select({ companyId: calls.companyId, id: calls.id })
    .from(calls)
    .where(
      or(
        and(eq(calls.analysisStatus, "pending"), lt(calls.createdAt, stuckSince)),
        and(eq(calls.analysisStatus, "analyzing"), lt(calls.analysisStartedAt, stuckSince)),
      ),
    )
    .orderBy(asc(sql`coalesce(${calls.analysisStartedAt}, ${calls.createdAt})`))
    .limit(limit);
}

// Image and video requests still waiting 2+ minutes after they were made
// (their run never started), or being made 15+ minutes after their run
// started (it was cut off; a third such one is ended as "interrupted" by
// its own path), least recently tried first.
export async function findStuckGenerationJobs(limit: number): Promise<StuckItem[]> {
  return db
    .select({ companyId: mediaGenerationJobs.companyId, id: mediaGenerationJobs.id })
    .from(mediaGenerationJobs)
    // The status list again, so Postgres can use the index of unfinished jobs.
    .where(and(inArray(mediaGenerationJobs.status, ["queued", "running"]), isStuckJob()))
    .orderBy(asc(sql`coalesce(${mediaGenerationJobs.startedAt}, ${mediaGenerationJobs.createdAt})`))
    .limit(limit);
}
