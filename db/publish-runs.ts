import "server-only";
import { and, asc, eq, inArray, lte, notInArray, sql, type SQL } from "drizzle-orm";
import { STALE_PUBLISHING_MINUTES } from "@/lib/publishing/limits";
import { db, type DbTransaction } from "./client";
import { recordActivity } from "./cofounder-activity";
import { syncDraftWithJobs } from "./publish-draft-sync";
import { contentDrafts, publishJobs } from "./schema";

// Claiming publish jobs (step 41). A run CLAIMS a job in ONE UPDATE
// (queued and due -> publishing, claimed_at, a new claim_id, attempts + 1)
// before anything else, so two runs never both send it; every later read
// and write of that run names its claim (heldBy), so a late writer never
// undoes what another decided. A job still "publishing" 10+ minutes after
// its claim was cut off while sending: it may have gone out, so it is
// never claimed again, only handed to a person ("needs attention"). A run
// asks the platform only while its claim is young enough for the
// platform's longest answer to come before then (checkClaimBeforeSending).

// What a run holds once it claimed a job. attempt: its try, counted for a
// platform's "slow down" (lib/publishing/limits.ts, MAX_PUBLISH_ATTEMPTS).
export type PublishClaim = { companyId: string; jobId: string; draftId: string; connectionId: string; claimId: string; attempt: number };

export type StalePublishingJob = Omit<PublishClaim, "claimId" | "attempt">;

// Whose due jobs a runner looks at: every company but skipCompanyIds (those
// that had their turn in this round, or whose daily limit held a post back:
// services/publish-runs.ts), and only onlyCompanyIds when given (the checks
// keep to their own companies).
export type DueJobScope = { skipCompanyIds?: string[]; onlyCompanyIds?: string[] };

const claimedColumns = {
  status: "publishing" as const,
  claimedAt: sql`now()`,
  claimId: sql`gen_random_uuid()`,
  attempts: sql`${publishJobs.attempts} + 1`,
  updatedAt: sql`now()`,
};

const claimReturning = {
  companyId: publishJobs.companyId,
  jobId: publishJobs.id,
  draftId: publishJobs.draftId,
  connectionId: publishJobs.connectionId,
  claimId: publishJobs.claimId,
  attempt: publishJobs.attempts,
};

// The job as this run claimed it: still "publishing", under its claim id.
// Every read and write of a run goes through it (db/publish-run-read.ts,
// db/publish-outcomes.ts).
export function heldBy(claim: PublishClaim) {
  return and(
    eq(publishJobs.companyId, claim.companyId),
    eq(publishJobs.id, claim.jobId),
    eq(publishJobs.status, "publishing"),
    eq(publishJobs.claimId, claim.claimId),
  );
}

// Claims one job of one company in ONE UPDATE while it waits and is due
// (right after scheduling it for now, "Publish now", a Retry). Undefined:
// another run has it, it was canceled, or it isn't due.
export async function claimPublishJob(companyId: string, jobId: string): Promise<PublishClaim | undefined> {
  const [claimed] = await db
    .update(publishJobs)
    .set(claimedColumns)
    .where(and(eq(publishJobs.companyId, companyId), eq(publishJobs.id, jobId), eq(publishJobs.status, "queued"), lte(publishJobs.runAfter, sql`now()`)))
    .returning(claimReturning);
  return claimed;
}

// Claims the next due job in the scope in ONE UPDATE: the longest waiting
// first, SKIP LOCKED so two runners never wait for each other or take the
// same one. WHY "id = (subquery)", not "id IN (subquery)": Postgres may run
// an IN subquery again for each row it looks at, and with SKIP LOCKED each
// run skips the row just locked and picks the next, so one UPDATE could
// claim several jobs (only one of them returned, the others left
// "publishing"). A scalar subquery runs once. Not company-scoped on
// purpose: the runners (/api/cron/publish, the daily job) have no session
// and serve every company; the work then runs through the company-scoped
// paths with the row's own company.
export async function claimNextDuePublishJob(scope: DueJobScope = {}): Promise<PublishClaim | undefined> {
  const next = db
    .select({ id: publishJobs.id })
    .from(publishJobs)
    .where(isDueIn(scope))
    .orderBy(asc(publishJobs.runAfter), asc(publishJobs.id))
    .limit(1)
    .for("update", { skipLocked: true });
  const [claimed] = await db
    .update(publishJobs)
    .set(claimedColumns)
    .where(and(eq(publishJobs.id, sql`(${next})`), eq(publishJobs.status, "queued")))
    .returning(claimReturning);
  return claimed;
}

// Whether a due job still waits in the scope: a runner that stopped at its
// limit says so in the log. Cross-company like the claim; it reads one id.
export async function hasDuePublishJob(scope: DueJobScope = {}): Promise<boolean> {
  const [due] = await db.select({ id: publishJobs.id }).from(publishJobs).where(isDueIn(scope)).limit(1);
  return due !== undefined;
}

// Right before the platform is asked: whether this run still holds the job
// ("lost": it ended, or a later run has it), and whether its claim is under
// latestSendStartMs old ("too_late": the platform's longest answer could
// come after the claim counts as cut off, and a person may then send it
// again). Our own database's clock, as for claimed_at.
export async function checkClaimBeforeSending(claim: PublishClaim, latestSendStartMs: number): Promise<"held" | "too_late" | "lost"> {
  const [held] = await db
    .select({ young: sql<boolean>`${publishJobs.claimedAt} > now() - make_interval(secs => ${latestSendStartMs / 1000})` })
    .from(publishJobs)
    .where(heldBy(claim));
  if (!held) {
    return "lost";
  }
  return held.young ? "held" : "too_late";
}

// Jobs still "publishing" 10+ minutes after their claim, of every company
// (or only of these: the checks), oldest claim first. Cross-company for the
// same reason as above: it only reads ids, each is ended through the
// company-scoped path below.
export async function findStalePublishingJobs(limit: number, onlyCompanyIds?: string[]): Promise<StalePublishingJob[]> {
  return db
    .select({ companyId: publishJobs.companyId, jobId: publishJobs.id, draftId: publishJobs.draftId, connectionId: publishJobs.connectionId })
    .from(publishJobs)
    .where(and(isCutOffWhileSending(), onlyCompanyIds ? inArray(publishJobs.companyId, onlyCompanyIds) : undefined))
    .orderBy(asc(publishJobs.claimedAt))
    .limit(limit);
}

// Hands one stale job of one company to a person: "needs attention",
// "interrupted", never queued again (no platform offers a way to send a post
// only once, so a second try could post it twice). The draft's row is
// locked first, as everywhere. False: it finished (or was handed over)
// meanwhile.
export async function markStaleJobNeedsAttention(job: StalePublishingJob): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: contentDrafts.id })
      .from(contentDrafts)
      .where(and(eq(contentDrafts.companyId, job.companyId), eq(contentDrafts.id, job.draftId)))
      .for("update");
    return handOverCutOffJobWithin(tx, job);
  });
}

// Inside a transaction that locked the job's draft: the job "needs
// attention" ("interrupted") if it is still "publishing" 10+ minutes after
// its claim, the draft's status following and the app's activity row with
// it. False: it isn't (it finished, or was handed over, meanwhile). Besides
// the runners, a person's Mark or Retry calls it first: the pages show such
// a post as needing attention at once (db/publish-jobs.ts), while on
// Vercel Hobby the next runner may be a day away.
export async function handOverCutOffJobWithin(tx: DbTransaction, job: StalePublishingJob): Promise<boolean> {
  const ended = await tx
    .update(publishJobs)
    .set({ status: "needs_attention", lastError: "interrupted", updatedAt: sql`now()` })
    .where(and(eq(publishJobs.companyId, job.companyId), eq(publishJobs.id, job.jobId), isCutOffWhileSending()))
    .returning({ id: publishJobs.id });
  if (ended.length === 0) {
    return false;
  }
  await syncDraftWithJobs(tx, job.companyId, job.draftId);
  const entry = { action: "needs_attention" as const, actorUserId: null, draftId: job.draftId, jobId: job.jobId, connectionId: job.connectionId, code: "interrupted" };
  await recordActivity(tx, job.companyId, [entry]);
  return true;
}

// Still "publishing" 10+ minutes after its claim: the run sending it was cut
// off (a live run asks the platform only while its claim is younger,
// services/publish-attempt.ts, so none is still sending by then).
export function isCutOffWhileSending(): SQL {
  return sql`(${publishJobs.status} = 'publishing' and ${publishJobs.claimedAt} < now() - make_interval(mins => ${STALE_PUBLISHING_MINUTES}))`;
}

function isDueIn(scope: DueJobScope) {
  const skipped = scope.skipCompanyIds ?? [];
  return and(
    eq(publishJobs.status, "queued"),
    lte(publishJobs.runAfter, sql`now()`),
    skipped.length > 0 ? notInArray(publishJobs.companyId, skipped) : undefined,
    scope.onlyCompanyIds ? inArray(publishJobs.companyId, scope.onlyCompanyIds) : undefined,
  );
}
