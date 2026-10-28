import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { draftStatusFromJobs, QUEUE_DRAFT_STATUSES } from "@/lib/publishing/draft-status";
import { hasApprovalOf } from "@/lib/publishing/run-check";
import type { DbTransaction } from "./client";
import { recordActivity } from "./cofounder-activity";
import { contentDrafts, publishJobs } from "./schema";

// What a draft and its publish jobs (step 41) do to each other, inside the
// transaction of the change, with the draft's row already locked by the
// caller (the lock order everywhere: the person, the draft, then its jobs):
// the draft's status follows its jobs, and a change of the draft takes its
// waiting posts out of the queue. Jobs being sent right now, or sent, are
// never touched here: the check right before sending catches a change.

// Sets a draft's status from its jobs while the queue has it (scheduled,
// published or failed; lib/publishing/draft-status.ts). A status a person
// chose since (an edit made it a draft again, a rejection, an archive) stays.
export async function syncDraftWithJobs(tx: DbTransaction, companyId: string, draftId: string): Promise<void> {
  const [draft] = await tx
    .select({
      status: contentDrafts.status,
      version: contentDrafts.version,
      approvedByUserId: contentDrafts.approvedByUserId,
      approvedVersion: contentDrafts.approvedVersion,
    })
    .from(contentDrafts)
    .where(and(eq(contentDrafts.companyId, companyId), eq(contentDrafts.id, draftId)));
  if (!draft || !QUEUE_DRAFT_STATUSES.includes(draft.status)) {
    return;
  }
  const jobs = await tx
    .select({ connectionId: publishJobs.connectionId, status: publishJobs.status })
    .from(publishJobs)
    .where(and(eq(publishJobs.companyId, companyId), eq(publishJobs.draftId, draftId)));
  const next = draftStatusFromJobs(jobs, hasApprovalOf(draft, draft.version));
  if (next !== draft.status) {
    await tx
      .update(contentDrafts)
      .set({ status: next })
      .where(and(eq(contentDrafts.companyId, companyId), eq(contentDrafts.id, draftId)));
  }
}

// Inside a change of a draft's content (an edit, the AI's new text, its
// image or video, its alt text): when the draft was approved or had posts
// waiting, records that it changed after approval and cancels those posts
// (they need approving and scheduling again).
export async function cancelQueuedJobsAfterChange(
  tx: DbTransaction,
  companyId: string,
  actorUserId: string,
  draft: { id: string; approvedByUserId: string | null },
): Promise<void> {
  const queued = await lockQueuedJobs(tx, companyId, draft.id);
  if (draft.approvedByUserId === null && queued.length === 0) {
    return;
  }
  await recordActivity(tx, companyId, [{ action: "draft_changed_after_approval", actorUserId, draftId: draft.id }]);
  await cancelJobs(tx, companyId, actorUserId, draft.id, queued, "draft_changed");
}

// Inside a rejection or an archive: cancels the draft's waiting posts,
// saying why (draft_rejected, draft_archived).
export async function cancelQueuedJobsOfDraft(tx: DbTransaction, companyId: string, actorUserId: string, draftId: string, code: string): Promise<void> {
  await cancelJobs(tx, companyId, actorUserId, draftId, await lockQueuedJobs(tx, companyId, draftId), code);
}

type QueuedJob = { id: string; connectionId: string };

// The draft's waiting jobs, locked until the transaction ends: a run
// claiming one at this moment either got it first (it is "publishing" now,
// and not here) or waits and then finds it canceled.
async function lockQueuedJobs(tx: DbTransaction, companyId: string, draftId: string): Promise<QueuedJob[]> {
  return tx
    .select({ id: publishJobs.id, connectionId: publishJobs.connectionId })
    .from(publishJobs)
    .where(and(eq(publishJobs.companyId, companyId), eq(publishJobs.draftId, draftId), eq(publishJobs.status, "queued")))
    .for("update");
}

async function cancelJobs(tx: DbTransaction, companyId: string, actorUserId: string, draftId: string, jobs: QueuedJob[], code: string): Promise<void> {
  for (const job of jobs) {
    await tx
      .update(publishJobs)
      .set({ status: "canceled", canceledByUserId: actorUserId, updatedAt: sql`now()` })
      .where(and(eq(publishJobs.companyId, companyId), eq(publishJobs.id, job.id), eq(publishJobs.status, "queued")));
  }
  await recordActivity(
    tx,
    companyId,
    jobs.map((job) => ({ action: "canceled" as const, actorUserId, draftId, jobId: job.id, connectionId: job.connectionId, code })),
  );
}
