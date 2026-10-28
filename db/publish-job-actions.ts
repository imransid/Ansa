import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { canManagePublishing } from "@/lib/cofounder/permissions";
import type { CofounderActivityAction } from "@/lib/publishing/activity-actions";
import type { PublishJobStatus } from "@/lib/publishing/kinds";
import { db, type DbTransaction } from "./client";
import { recordActivity } from "./cofounder-activity";
import { lockActiveAuthorRole } from "./knowledge-author";
import { syncDraftWithJobs } from "./publish-draft-sync";
import { handOverCutOffJobWithin } from "./publish-runs";
import { contentDrafts, publishJobs } from "./schema";

// What an owner does to one of the company's publish jobs (step 41) on the
// queue or a draft's page: cancel a waiting post, send one now, and say
// what became of one that needs attention after checking the platform.
// Each in ONE transaction: the owner's role read again (locked), then the
// draft's row, then the job's (the lock order everywhere), the draft's
// status following its jobs, and the change recorded in the activity log.
// A Retry is db/publish-scheduling.ts (it is checked like a new schedule).

export type JobActionOutcome = "changed" | "not-found" | "not-allowed" | "wrong-status";

export type LockedJob = { draftId: string; connectionId: string; status: PublishJobStatus };

// Cancels one of the company's waiting posts: it never goes out.
export async function cancelPublishJob(companyId: string, actorUserId: string, jobId: string): Promise<JobActionOutcome> {
  return changeLockedJob(companyId, actorUserId, jobId, { from: ["queued"], action: "canceled" }, async (tx) => {
    await tx
      .update(publishJobs)
      .set({ status: "canceled", canceledByUserId: actorUserId, updatedAt: sql`now()` })
      .where(and(eq(publishJobs.companyId, companyId), eq(publishJobs.id, jobId)));
  });
}

// "Publish now": a waiting post's time becomes now; it is sent right after
// the answer (services/publish-job-actions.ts), checked as every run is.
export async function bringPublishJobForward(companyId: string, actorUserId: string, jobId: string): Promise<JobActionOutcome> {
  return changeLockedJob(companyId, actorUserId, jobId, { from: ["queued"], action: "publish_now" }, async (tx) => {
    await tx
      .update(publishJobs)
      .set({ scheduledFor: sql`now()`, runAfter: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(publishJobs.companyId, companyId), eq(publishJobs.id, jobId)));
  });
}

// "Mark as published": an owner checked the platform and the post is there,
// at postUrl if they gave its address (already checked against the
// platform's hosts). The reason it needed attention stays on the job.
export async function markJobPublished(companyId: string, actorUserId: string, jobId: string, postUrl: string | null): Promise<JobActionOutcome> {
  return changeLockedJob(companyId, actorUserId, jobId, { from: ["needs_attention"], action: "marked_published" }, async (tx) => {
    await tx
      .update(publishJobs)
      .set({ status: "published", publishedAt: sql`now()`, externalUrl: postUrl, updatedAt: sql`now()` })
      .where(and(eq(publishJobs.companyId, companyId), eq(publishJobs.id, jobId)));
  });
}

// "Mark as not published": an owner checked and the post isn't there, so it
// failed (with the reason it needed attention); a Retry may send it again.
export async function markJobNotPublished(companyId: string, actorUserId: string, jobId: string): Promise<JobActionOutcome> {
  return changeLockedJob(companyId, actorUserId, jobId, { from: ["needs_attention"], action: "marked_not_published" }, async (tx) => {
    await tx
      .update(publishJobs)
      .set({ status: "failed", updatedAt: sql`now()` })
      .where(and(eq(publishJobs.companyId, companyId), eq(publishJobs.id, jobId)));
  });
}

// The steps every action above shares: the owner, the job's draft locked,
// the job locked (one cut off while sending handed to a person first) and
// in one of the statuses the action starts from, the change, the draft's
// status, the activity row.
async function changeLockedJob(
  companyId: string,
  actorUserId: string,
  jobId: string,
  rule: { from: readonly PublishJobStatus[]; action: CofounderActivityAction },
  change: (tx: DbTransaction) => Promise<void>,
): Promise<JobActionOutcome> {
  return db.transaction(async (tx) => {
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    if (!role || !canManagePublishing(role)) {
      return "not-allowed";
    }
    const job = await lockJobAndItsDraft(tx, companyId, jobId);
    if (!job) {
      return "not-found";
    }
    const status = await statusAfterHandOver(tx, companyId, jobId, job);
    if (!rule.from.includes(status)) {
      return "wrong-status";
    }
    await change(tx);
    await syncDraftWithJobs(tx, companyId, job.draftId);
    await recordActivity(tx, companyId, [{ action: rule.action, actorUserId, draftId: job.draftId, jobId, connectionId: job.connectionId }]);
    return "changed";
  });
}

// The job's status once a post cut off while sending (still "publishing"
// 10+ minutes after its claim) is handed to a person in this transaction:
// the pages show it as needing attention already (db/publish-jobs.ts),
// and the runners may be a day away. Its draft is locked by then.
export async function statusAfterHandOver(tx: DbTransaction, companyId: string, jobId: string, job: LockedJob): Promise<PublishJobStatus> {
  if (job.status !== "publishing") {
    return job.status;
  }
  const handedOver = await handOverCutOffJobWithin(tx, { companyId, jobId, draftId: job.draftId, connectionId: job.connectionId });
  return handedOver ? "needs_attention" : job.status;
}

// Locks the job's draft, then the job (a job's draft never changes, so it
// can be read first): the order every change of drafts and jobs takes.
async function lockJobAndItsDraft(tx: DbTransaction, companyId: string, jobId: string): Promise<LockedJob | undefined> {
  const [found] = await tx
    .select({ draftId: publishJobs.draftId })
    .from(publishJobs)
    .where(and(eq(publishJobs.companyId, companyId), eq(publishJobs.id, jobId)));
  if (!found) {
    return undefined;
  }
  await tx
    .select({ id: contentDrafts.id })
    .from(contentDrafts)
    .where(and(eq(contentDrafts.companyId, companyId), eq(contentDrafts.id, found.draftId)))
    .for("update");
  const [job] = await tx
    .select({ draftId: publishJobs.draftId, connectionId: publishJobs.connectionId, status: publishJobs.status })
    .from(publishJobs)
    .where(and(eq(publishJobs.companyId, companyId), eq(publishJobs.id, jobId)))
    .for("update");
  return job;
}
