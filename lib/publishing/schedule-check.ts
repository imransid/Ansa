import type { FactValue } from "@/lib/content-studio/claims";
import type { ContentDraftStatus } from "@/lib/content-studio/formats";
import { PUBLISHED_FORMATS, type SocialConnectionStatus, type SocialPlatform } from "@/lib/social-platforms";
import type { PublishApprovalMode } from "./kinds";
import { contentReviewFor, hasApprovalOf, ruleApplies, type DraftForPublishing, type RuleForCheck } from "./run-check";

// Whether a draft may be scheduled to these accounts now (step 41), and
// under whose authority: an owner's approval of exactly this version, or,
// when the owner chose to send it without one, an enabled auto-publish rule
// covering it. Pure: the scheduling transaction (db/publish-scheduling.ts)
// reads everything with the draft's row locked and decides here; a Retry
// decides the same way. The same draft is checked again when its job runs
// (run-check.ts).

// "stale": the draft changed since the page showed it. "wrong-status": an
// idea, a rejected or an archived draft. "not-approved": no approval of
// this version, and the owner didn't choose the auto-publish rule.
// "approver-gone": who approved it is no longer an active owner. "no-rule":
// no enabled rule covers it. "rule-owner-gone": an owner behind the rule
// left or was made a member. "blocked": a rule of the platform isn't met.
// "claims-need-owner": a claim would need an owner's check, which a rule
// can't give. "account-not-connected": a picked account isn't a connected
// account of the draft's platform in the company. "already-scheduled": a
// picked account already has this draft on its way, out, or maybe out.
export type ScheduleRefusal =
  | "stale"
  | "wrong-status"
  | "not-approved"
  | "approver-gone"
  | "no-rule"
  | "rule-owner-gone"
  | "format-not-published"
  | "blocked"
  | "claims-need-owner"
  | "account-not-connected"
  | "already-scheduled";

export type ScheduleCheckInput = {
  // The version the page showed (a Retry passes the stored one).
  shownVersion: number;
  // The owner chose to send it under an auto-publish rule, without an approval.
  withoutApproval: boolean;
  draft: DraftForPublishing;
  approverIsActiveOwner: boolean;
  // The enabled rule of the company that covers the draft best, or null.
  rule: RuleForCheck | null;
  pickedAccountIds: string[];
  // The picked accounts found among the company's connections.
  accounts: { id: string; platform: SocialPlatform; status: SocialConnectionStatus }[];
  // Picked accounts that already have a job of this draft on its way, out or maybe out.
  accountsWithLiveJob: string[];
  facts: FactValue[];
};

export type ScheduleDecision = { ok: true; mode: PublishApprovalMode } | { ok: false; refusal: ScheduleRefusal };

// An owner's approval schedules a draft from these statuses (approved, or
// already on its way to other accounts); a rule also takes a plain draft.
const SCHEDULABLE_WITH_APPROVAL: readonly ContentDraftStatus[] = ["approved", "scheduled", "published", "failed"];
const SCHEDULABLE_UNDER_A_RULE: readonly ContentDraftStatus[] = ["draft", "scheduled", "published", "failed"];

// The decision, the draft first, then who stands behind it, the accounts,
// and last the content against the rules and the facts as they are now.
export function decideSchedule(input: ScheduleCheckInput): ScheduleDecision {
  const { draft } = input;
  if (draft.version !== input.shownVersion) {
    return refuse("stale");
  }
  if (!SCHEDULABLE_UNDER_A_RULE.includes(draft.status) && !SCHEDULABLE_WITH_APPROVAL.includes(draft.status)) {
    return refuse("wrong-status");
  }
  if (!PUBLISHED_FORMATS[draft.platform].includes(draft.format)) {
    return refuse("format-not-published");
  }
  const mode = decideMode(input);
  if (typeof mode !== "string") {
    return mode;
  }
  const accountRefusal = findAccountRefusal(input);
  if (accountRefusal) {
    return refuse(accountRefusal);
  }
  const review = contentReviewFor(draft, input.facts);
  if (review.blocked) {
    return refuse("blocked");
  }
  return mode === "auto_rule" && review.claimsNeedAnOwner ? refuse("claims-need-owner") : { ok: true, mode };
}

function decideMode(input: ScheduleCheckInput): PublishApprovalMode | ScheduleDecision {
  const { draft } = input;
  if (hasApprovalOf(draft, draft.version) && SCHEDULABLE_WITH_APPROVAL.includes(draft.status)) {
    return input.approverIsActiveOwner ? "owner" : refuse("approver-gone");
  }
  if (!input.withoutApproval) {
    return refuse("not-approved");
  }
  if (!SCHEDULABLE_UNDER_A_RULE.includes(draft.status)) {
    return refuse("wrong-status");
  }
  if (!input.rule || !ruleApplies(input.rule, draft)) {
    return refuse("no-rule");
  }
  return input.rule.ownersActive ? "auto_rule" : refuse("rule-owner-gone");
}

function findAccountRefusal(input: ScheduleCheckInput): ScheduleRefusal | null {
  const usable = input.pickedAccountIds.every((id) =>
    input.accounts.some((account) => account.id === id && account.status === "connected" && account.platform === input.draft.platform),
  );
  if (input.pickedAccountIds.length === 0 || !usable) {
    return "account-not-connected";
  }
  return input.accountsWithLiveJob.length > 0 ? "already-scheduled" : null;
}

function refuse(refusal: ScheduleRefusal): ScheduleDecision {
  return { ok: false, refusal };
}
