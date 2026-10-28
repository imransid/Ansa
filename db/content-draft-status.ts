import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { canReviewContentDrafts } from "@/lib/cofounder/permissions";
import type { ContentIssue } from "@/lib/content-rules";
import { APPROVABLE_STATUSES, ARCHIVABLE_STATUSES, REJECTABLE_STATUSES, statusAfterContentChange } from "@/lib/content-studio/draft-fields";
import { reviewDraft } from "@/lib/content-studio/review";
import { QUEUE_DRAFT_STATUSES } from "@/lib/publishing/draft-status";
import { hasApprovalOf } from "@/lib/publishing/run-check";
import { readConfirmedFactValues } from "./business-facts";
import { db, type DbTransaction } from "./client";
import { recordActivity } from "./cofounder-activity";
import { attachedMedia, lockDraft, NO_APPROVAL } from "./content-draft-rows";
import type { DraftChangeOutcome } from "./content-draft-writes";
import { lockActiveAuthorRole } from "./knowledge-author";
import { cancelQueuedJobsOfDraft } from "./publish-draft-sync";
import { contentDrafts } from "./schema";

// What happens to one company's content draft besides its content (step
// 38): owners approve and reject; anyone active in the company archives and
// restores. The person's role is read again, locked, in each transaction
// (db/knowledge-author.ts says why). Each is recorded in the activity log,
// and a rejection or an archive cancels the draft's waiting posts, in the
// same transaction (step 41).

export type ApproveOutcome =
  | { outcome: "approved" }
  // A rule of the platform isn't met (lib/content-rules.ts).
  | { outcome: "blocked"; issues: ContentIssue[] }
  // A claim isn't backed by a confirmed fact (or nobody listed the claims),
  // and the owner didn't tick "I checked these claims".
  | { outcome: "claims-not-checked" }
  | { outcome: Exclude<DraftChangeOutcome, "changed"> };

// Approves one draft of one company as the version the owner read. WHY the
// rules and the claims are checked here, on the row as stored and the facts
// as confirmed now, inside the transaction that writes: the page's own
// check could be minutes old, and the approval must be of exactly this
// text. Records approved_version (the database refuses an approval of any
// other version than the current one). An approval by someone made a member
// or removed since lets nothing go out (step 41, lib/publishing/run-check.ts),
// so another owner may approve the same version again: the approval becomes
// theirs. A draft the queue has (scheduled, published or failed: one an
// auto-publish rule sent has no approval) keeps the status its posts give
// it, so marking one of them later still moves it.
export async function approveContentDraft(
  companyId: string,
  actorUserId: string,
  approval: { draftId: string; version: number; claimsChecked: boolean },
): Promise<ApproveOutcome> {
  return db.transaction(async (tx) => {
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    const draft = await lockDraft(tx, companyId, approval.draftId);
    if (!draft) {
      return { outcome: "not-found" };
    }
    if (!role || !canReviewContentDrafts(role)) {
      return { outcome: "not-allowed" };
    }
    const replacing = hasApprovalOf(draft, draft.version);
    // Approved already by an owner who still is one (also while it is being
    // published): nothing to do. The approver's row is locked FOR SHARE, as
    // the person's is: a demotion saved at this moment is waited for, then seen.
    if (replacing && (await approverIsActiveOwner(tx, companyId, draft.approvedByUserId))) {
      return { outcome: draft.version === approval.version ? "unchanged" : "stale" };
    }
    if (!replacing && !APPROVABLE_STATUSES.includes(draft.status)) {
      return { outcome: "wrong-status" };
    }
    if (draft.version !== approval.version) {
      return { outcome: "stale" };
    }
    const media = await attachedMedia(tx, companyId, draft.mediaAssetId);
    const review = reviewDraft({ ...draft, media }, await readConfirmedFactValues(tx, companyId));
    if (review.blockingIssues.length > 0) {
      return { outcome: "blocked", issues: review.blockingIssues };
    }
    if (review.acknowledgmentNeeded && !approval.claimsChecked) {
      return { outcome: "claims-not-checked" };
    }
    const acknowledgment = review.acknowledgmentNeeded
      ? { claimsAcknowledgedByUserId: actorUserId, claimsAcknowledgedAt: sql`now()` }
      : { claimsAcknowledgedByUserId: null, claimsAcknowledgedAt: null };
    await tx
      .update(contentDrafts)
      .set({
        // The queue's status stays: its posts decide it (db/publish-draft-sync.ts).
        status: QUEUE_DRAFT_STATUSES.includes(draft.status) ? draft.status : "approved",
        approvedByUserId: actorUserId,
        approvedAt: sql`now()`,
        approvedVersion: approval.version,
        ...acknowledgment,
        // Approved: the last rejection is over.
        rejectedByUserId: null,
        rejectedAt: null,
        rejectionNote: null,
      })
      .where(and(eq(contentDrafts.companyId, companyId), eq(contentDrafts.id, approval.draftId), eq(contentDrafts.version, approval.version)));
    await recordActivity(tx, companyId, [{ action: "draft_approved", actorUserId, draftId: approval.draftId }]);
    return { outcome: "approved" };
  });
}

// Whether whoever approved a draft is still an active owner of the company.
async function approverIsActiveOwner(tx: DbTransaction, companyId: string, approverUserId: string | null): Promise<boolean> {
  return approverUserId !== null && (await lockActiveAuthorRole(tx, companyId, approverUserId)) === "owner";
}

// Rejects one draft of one company as the version the owner read, with
// their note (null: none). An approved draft loses its approval.
export async function rejectContentDraft(
  companyId: string,
  actorUserId: string,
  rejection: { draftId: string; version: number; note: string | null },
): Promise<DraftChangeOutcome> {
  return db.transaction(async (tx) => {
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    const draft = await lockDraft(tx, companyId, rejection.draftId);
    if (!draft) {
      return "not-found";
    }
    if (!role || !canReviewContentDrafts(role)) {
      return "not-allowed";
    }
    if (draft.status === "rejected") {
      return draft.version === rejection.version ? "unchanged" : "stale";
    }
    if (!REJECTABLE_STATUSES.includes(draft.status)) {
      return "wrong-status";
    }
    if (draft.version !== rejection.version) {
      return "stale";
    }
    await tx
      .update(contentDrafts)
      .set({ status: "rejected", rejectedByUserId: actorUserId, rejectedAt: sql`now()`, rejectionNote: rejection.note, ...NO_APPROVAL })
      .where(and(eq(contentDrafts.companyId, companyId), eq(contentDrafts.id, rejection.draftId), eq(contentDrafts.version, rejection.version)));
    await recordActivity(tx, companyId, [{ action: "draft_rejected", actorUserId, draftId: rejection.draftId }]);
    await cancelQueuedJobsOfDraft(tx, companyId, actorUserId, rejection.draftId, "draft_rejected");
    return "changed";
  });
}

// Archives one draft of one company: nobody approves or publishes it while
// it is archived, and an approval it had is gone. Anyone in the company.
export async function archiveContentDraft(companyId: string, actorUserId: string, draftId: string): Promise<DraftChangeOutcome> {
  return db.transaction(async (tx) => {
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    const draft = await lockDraft(tx, companyId, draftId);
    if (!draft) {
      return "not-found";
    }
    if (!role) {
      return "not-allowed";
    }
    if (draft.status === "archived") {
      return "unchanged";
    }
    if (!ARCHIVABLE_STATUSES.includes(draft.status)) {
      return "wrong-status";
    }
    await tx
      .update(contentDrafts)
      .set({ status: "archived", ...NO_APPROVAL })
      .where(and(eq(contentDrafts.companyId, companyId), eq(contentDrafts.id, draftId)));
    await recordActivity(tx, companyId, [{ action: "draft_archived", actorUserId, draftId }]);
    await cancelQueuedJobsOfDraft(tx, companyId, actorUserId, draftId, "draft_archived");
    return "changed";
  });
}

// Restores one archived draft of one company as a draft (an idea when
// nothing is written), to be approved again. Anyone in the company. One that
// isn't archived (someone restored it meanwhile) is "unchanged".
export async function restoreContentDraft(companyId: string, actorUserId: string, draftId: string): Promise<DraftChangeOutcome> {
  return db.transaction(async (tx) => {
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    const draft = await lockDraft(tx, companyId, draftId);
    if (!draft) {
      return "not-found";
    }
    if (!role) {
      return "not-allowed";
    }
    if (draft.status !== "archived") {
      return "unchanged";
    }
    await tx
      .update(contentDrafts)
      .set({ status: statusAfterContentChange(draft, draft.mediaAssetId !== null), ...NO_APPROVAL })
      .where(and(eq(contentDrafts.companyId, companyId), eq(contentDrafts.id, draftId)));
    await recordActivity(tx, companyId, [{ action: "draft_restored", actorUserId, draftId }]);
    return "changed";
  });
}
