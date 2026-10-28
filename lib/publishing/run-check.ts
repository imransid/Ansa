import type { FactValue } from "@/lib/content-studio/claims";
import type { ContentDraftStatus } from "@/lib/content-studio/formats";
import { reviewDraft, type DraftForReview } from "@/lib/content-studio/review";
import { PUBLISHED_FORMATS, type SocialConnectionStatus, type SocialPlatform } from "@/lib/social-platforms";
import type { PublishJobErrorCode } from "./job-errors";
import type { PublishApprovalMode } from "./kinds";

// The check right before a post is sent (step 41): permission is decided
// when the job RUNS, never trusted from when it was scheduled. Everything is
// read in one snapshot (db/publish-runs.ts): the job, its draft as stored
// now, its account, who stands behind it (the owner who approved it, or the
// rule and the owners behind that), and the confirmed facts now. Pure, and
// the scheduling transaction uses the same pieces (schedule-check.ts).

export type DraftForPublishing = DraftForReview & {
  status: ContentDraftStatus;
  pillar: string;
  approvedByUserId: string | null;
  approvedVersion: number | null;
};

// An auto-publish rule as the checks read it. ownersActive: the owner who
// made it and the owner who turned it on are both still active owners.
export type RuleForCheck = { enabled: boolean; platform: SocialPlatform; pillar: string; ownersActive: boolean };

export type PublishCheckInput = {
  approvalMode: PublishApprovalMode;
  // The draft version the job may publish.
  approvedVersion: number;
  draft: DraftForPublishing;
  // The owner who approved the draft is still an active owner of the company.
  approverIsActiveOwner: boolean;
  // auto_rule: the job's rule (null: none).
  rule: RuleForCheck | null;
  // null: not an account of this company.
  connection: { platform: SocialPlatform; status: SocialConnectionStatus } | null;
  facts: FactValue[];
};

// Why the job may not go out now, or null when it may: the draft first
// (what was approved), then who stands behind it, the account, and last the
// content against the platform's rules and the facts as they are now.
export function findReasonNotToPublish(input: PublishCheckInput): PublishJobErrorCode | null {
  return draftProblem(input) ?? approvalProblem(input) ?? accountProblem(input) ?? contentProblem(input);
}

// Whether an owner's approval covers exactly this version of the draft.
export function hasApprovalOf(draft: Pick<DraftForPublishing, "approvedByUserId" | "approvedVersion">, version: number): boolean {
  return draft.approvedByUserId !== null && draft.approvedVersion === version;
}

// Whether an enabled auto-publish rule covers a draft: the same platform,
// and the rule's pillar ("" = any) exactly the draft's (both are the plan's
// own spelling: a draft picks its pillar from the plan's list).
export function ruleApplies(rule: Pick<RuleForCheck, "enabled" | "platform" | "pillar">, draft: { platform: SocialPlatform; pillar: string }): boolean {
  return rule.enabled && rule.platform === draft.platform && (rule.pillar === "" || rule.pillar === draft.pillar);
}

// What the content review says for publishing: a blocking issue stops every
// post; under a rule, so does any claim an owner would have to check
// (lib/content-studio/review.ts), since no owner reads it before it goes out.
export function contentReviewFor(draft: DraftForReview, facts: FactValue[]): { blocked: boolean; claimsNeedAnOwner: boolean } {
  const review = reviewDraft(draft, facts);
  return { blocked: review.blockingIssues.length > 0, claimsNeedAnOwner: review.acknowledgmentNeeded };
}

function draftProblem({ draft, approvedVersion }: PublishCheckInput): PublishJobErrorCode | null {
  if (draft.status === "archived") {
    return "draft_archived";
  }
  if (draft.status === "rejected") {
    return "draft_rejected";
  }
  if (draft.version !== approvedVersion) {
    return "draft_changed";
  }
  if (draft.status !== "scheduled" && draft.status !== "approved") {
    return "approval_no_longer_valid";
  }
  return PUBLISHED_FORMATS[draft.platform].includes(draft.format) ? null : "format_not_published";
}

function approvalProblem(input: PublishCheckInput): PublishJobErrorCode | null {
  if (input.approvalMode === "owner") {
    if (!hasApprovalOf(input.draft, input.approvedVersion)) {
      return "approval_no_longer_valid";
    }
    return input.approverIsActiveOwner ? null : "approver_not_owner";
  }
  if (!input.rule || !ruleApplies(input.rule, input.draft)) {
    return "rule_disabled";
  }
  return input.rule.ownersActive ? null : "rule_owner_gone";
}

function accountProblem({ connection, draft }: PublishCheckInput): PublishJobErrorCode | null {
  if (!connection || connection.status === "disconnected") {
    return "account_disconnected";
  }
  if (connection.status === "needs_reauth") {
    return "account_needs_reconnect";
  }
  return connection.platform === draft.platform ? null : "wrong_account";
}

function contentProblem({ draft, facts, approvalMode }: PublishCheckInput): PublishJobErrorCode | null {
  const review = contentReviewFor(draft, facts);
  if (review.blocked) {
    return "draft_has_problems";
  }
  return approvalMode === "auto_rule" && review.claimsNeedAnOwner ? "claims_not_checked" : null;
}
