import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { canManagePublishing } from "@/lib/cofounder/permissions";
import type { PublishApprovalMode } from "@/lib/publishing/kinds";
import { decideSchedule, type ScheduleRefusal } from "@/lib/publishing/schedule-check";
import { db } from "./client";
import { recordActivity } from "./cofounder-activity";
import { lockDraft } from "./content-draft-rows";
import { isUniqueViolation } from "./errors";
import { lockActiveAuthorRole } from "./knowledge-author";
import { statusAfterHandOver } from "./publish-job-actions";
import { markDraftScheduled, readScheduleContext } from "./publish-schedule-context";
import { publishJobs } from "./schema";

// Scheduling one company's drafts to its accounts (step 41), and trying a
// post that didn't go out again: owners only, each in ONE transaction with
// the draft's row locked (the person first, then the draft, its accounts
// and its jobs: the lock order everywhere), deciding with
// lib/publishing/schedule-check.ts on the draft as stored and the facts as
// confirmed now. Two schedules of one draft wait for each other on its
// row; the partial unique index refuses a second live job for one draft and
// account anyway.

export type ScheduleRequest = {
  draftId: string;
  // The version the page showed.
  version: number;
  connectionIds: string[];
  // null: now, by the database's clock.
  scheduledFor: Date | null;
  withoutApproval: boolean;
};

export type ScheduleOutcome =
  | { outcome: "scheduled"; jobIds: string[]; mode: PublishApprovalMode }
  | { outcome: ScheduleRefusal | "not-found" | "not-allowed" };

export type RetryOutcome = { outcome: "retried" } | { outcome: ScheduleRefusal | "not-found" | "not-allowed" | "not-retryable" };

// Schedules one draft of one company to one or more of its accounts, as the
// version the owner saw: one job per account, the draft scheduled, each job
// recorded in the activity log.
export async function scheduleDraftPosts(companyId: string, actorUserId: string, request: ScheduleRequest): Promise<ScheduleOutcome> {
  try {
    return await db.transaction(async (tx): Promise<ScheduleOutcome> => {
      const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
      if (!role || !canManagePublishing(role)) {
        return { outcome: "not-allowed" };
      }
      const draft = await lockDraft(tx, companyId, request.draftId);
      if (!draft) {
        return { outcome: "not-found" };
      }
      const context = await readScheduleContext(tx, companyId, { ...draft, id: request.draftId }, request.connectionIds, null);
      const decision = decideSchedule({ ...context, shownVersion: request.version, withoutApproval: request.withoutApproval, pickedAccountIds: request.connectionIds });
      if (!decision.ok) {
        return { outcome: decision.refusal };
      }
      const ruleId = decision.mode === "auto_rule" ? (context.rule?.id ?? null) : null;
      const at = request.scheduledFor ?? sql`now()`;
      const jobIds: string[] = [];
      // Every column named, never a spread of what was passed in.
      for (const connectionId of request.connectionIds) {
        const [job] = await tx
          .insert(publishJobs)
          .values({
            companyId,
            draftId: request.draftId,
            connectionId,
            scheduledFor: at,
            runAfter: at,
            status: "queued",
            approvalMode: decision.mode,
            approvedVersion: draft.version,
            autopublishRuleId: ruleId,
            createdByUserId: actorUserId,
          })
          .returning({ id: publishJobs.id });
        jobIds.push(job.id);
      }
      await markDraftScheduled(tx, companyId, request.draftId);
      const code = decision.mode === "auto_rule" ? "auto_rule" : null;
      await recordActivity(
        tx,
        companyId,
        jobIds.map((jobId, index) => ({ action: "scheduled" as const, actorUserId, draftId: request.draftId, jobId, connectionId: request.connectionIds[index], code })),
      );
      return { outcome: "scheduled", jobIds, mode: decision.mode };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { outcome: "already-scheduled" };
    }
    throw error;
  }
}

// Puts one of the company's posts that failed or needs attention back in
// the queue (one cut off while sending is handed to a person first), to go
// out now, checked like a new schedule: the draft as it is now (its
// approval of this version, or the rule covering it), the account
// connected, the facts now. It then publishes the draft's current version.
export async function retryPublishJob(companyId: string, actorUserId: string, jobId: string): Promise<RetryOutcome> {
  try {
    return await db.transaction(async (tx): Promise<RetryOutcome> => {
      const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
      if (!role || !canManagePublishing(role)) {
        return { outcome: "not-allowed" };
      }
      const [found] = await tx
        .select({ draftId: publishJobs.draftId })
        .from(publishJobs)
        .where(and(eq(publishJobs.companyId, companyId), eq(publishJobs.id, jobId)));
      const draft = found ? await lockDraft(tx, companyId, found.draftId) : undefined;
      const [job] = await tx
        .select({ status: publishJobs.status, connectionId: publishJobs.connectionId, approvalMode: publishJobs.approvalMode })
        .from(publishJobs)
        .where(and(eq(publishJobs.companyId, companyId), eq(publishJobs.id, jobId)))
        .for("update");
      if (!found || !draft || !job) {
        return { outcome: "not-found" };
      }
      const status = await statusAfterHandOver(tx, companyId, jobId, { ...job, draftId: found.draftId });
      if (status !== "failed" && status !== "needs_attention") {
        return { outcome: "not-retryable" };
      }
      const context = await readScheduleContext(tx, companyId, { ...draft, id: found.draftId }, [job.connectionId], jobId);
      const decision = decideSchedule({
        ...context,
        shownVersion: draft.version,
        withoutApproval: job.approvalMode === "auto_rule",
        pickedAccountIds: [job.connectionId],
      });
      if (!decision.ok) {
        return { outcome: decision.refusal };
      }
      await tx
        .update(publishJobs)
        .set({
          status: "queued",
          approvalMode: decision.mode,
          approvedVersion: draft.version,
          autopublishRuleId: decision.mode === "auto_rule" ? (context.rule?.id ?? null) : null,
          attempts: 0,
          scheduledFor: sql`now()`,
          runAfter: sql`now()`,
          lastError: null,
          externalPostId: null,
          externalUrl: null,
          publishedAt: null,
          updatedAt: sql`now()`,
        })
        .where(and(eq(publishJobs.companyId, companyId), eq(publishJobs.id, jobId), inArray(publishJobs.status, ["failed", "needs_attention"])));
      await markDraftScheduled(tx, companyId, found.draftId);
      await recordActivity(tx, companyId, [{ action: "retried", actorUserId, draftId: found.draftId, jobId, connectionId: job.connectionId }]);
      return { outcome: "retried" };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { outcome: "already-scheduled" };
    }
    throw error;
  }
}
