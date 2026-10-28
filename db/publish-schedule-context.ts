import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { LIVE_JOB_STATUSES } from "@/lib/publishing/kinds";
import type { RuleForCheck } from "@/lib/publishing/run-check";
import type { ScheduleCheckInput } from "@/lib/publishing/schedule-check";
import { lockRuleCoveringDraft } from "./autopublish-rules";
import { readConfirmedFactValues } from "./business-facts";
import type { DbTransaction } from "./client";
import { attachedMedia, type LockedDraft } from "./content-draft-rows";
import { lockActiveAuthorRole } from "./knowledge-author";
import { contentDrafts, publishJobs, socialConnections } from "./schema";

// What deciding a schedule (step 41, lib/publishing/schedule-check.ts) reads
// about one company's draft, inside the scheduling transaction, after the
// draft's row is locked: its image or video, whether its approver is still
// an active owner, the auto-publish rule covering it, the accounts picked,
// the jobs it has on them already, and the confirmed facts now. The people,
// rule and accounts are locked FOR SHARE: a demotion, a rule switched off
// or a disconnect saved at that moment is waited for, then seen.

export type ScheduleContext = Omit<ScheduleCheckInput, "shownVersion" | "withoutApproval" | "pickedAccountIds" | "rule"> & {
  rule: (RuleForCheck & { id: string }) | null;
};

// excludeJobId: a Retry's own job, which doesn't count as already there.
export async function readScheduleContext(
  tx: DbTransaction,
  companyId: string,
  draft: LockedDraft & { id: string },
  connectionIds: string[],
  excludeJobId: string | null,
): Promise<ScheduleContext> {
  const media = await attachedMedia(tx, companyId, draft.mediaAssetId);
  const approverRole = draft.approvedByUserId ? await lockActiveAuthorRole(tx, companyId, draft.approvedByUserId) : null;
  const rule = await lockRuleCoveringDraft(tx, companyId, draft);
  const accounts = await tx
    .select({ id: socialConnections.id, platform: socialConnections.platform, status: socialConnections.status })
    .from(socialConnections)
    .where(and(eq(socialConnections.companyId, companyId), inArray(socialConnections.id, connectionIds)))
    .for("share");
  const live = await tx
    .select({ connectionId: publishJobs.connectionId })
    .from(publishJobs)
    .where(
      and(
        eq(publishJobs.companyId, companyId),
        eq(publishJobs.draftId, draft.id),
        inArray(publishJobs.connectionId, connectionIds),
        inArray(publishJobs.status, [...LIVE_JOB_STATUSES]),
        excludeJobId ? ne(publishJobs.id, excludeJobId) : undefined,
      ),
    );
  return {
    draft: { ...draft, media },
    approverIsActiveOwner: approverRole === "owner",
    rule,
    accounts,
    accountsWithLiveJob: live.map((job) => job.connectionId),
    facts: await readConfirmedFactValues(tx, companyId),
  };
}

// The draft is on its way: scheduled (from approved, or from published or
// failed when it goes to more accounts or is tried again).
export async function markDraftScheduled(tx: DbTransaction, companyId: string, draftId: string): Promise<void> {
  await tx
    .update(contentDrafts)
    .set({ status: "scheduled" })
    .where(and(eq(contentDrafts.companyId, companyId), eq(contentDrafts.id, draftId)));
}
