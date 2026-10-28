import { describeConnectionError } from "@/lib/social-errors";
import { SOCIAL_PLATFORM_LABELS, type SocialPlatform } from "@/lib/social-platforms";
import type { CofounderActivityAction } from "./activity-actions";
import { describeJobError } from "./job-errors";

// The Co-Founder's activity log in plain words (step 41): one sentence per
// entry, as the queue page and a draft's page list them. Pure: the
// sentences are rendered as text, so a topic can't become markup.

export type ActivityForText = {
  action: CofounderActivityAction;
  code: string | null;
  // Empty: the app did it.
  actorUserId: string | null;
  actorName: string | null;
  draftTopic: string | null;
  draftPlatform: SocialPlatform | null;
  connectionPlatform: SocialPlatform | null;
  connectionName: string | null;
  rulePlatform: SocialPlatform | null;
  rulePillar: string | null;
  planVersion: number | null;
};

// "Ana scheduled “Our lunch menu” for LinkedIn (Ana Baker)."
export function describeActivity(entry: ActivityForText): string {
  const who = entry.actorUserId === null ? "ansa" : (entry.actorName ?? "A former teammate");
  return describeDraftOrAccountChange(entry, who) ?? describeJobChange(entry, who) ?? describeRuleOrPlanChange(entry, who);
}

function describeDraftOrAccountChange(entry: ActivityForText, who: string): string | null {
  const draft = draftName(entry);
  const account = accountName(entry);
  switch (entry.action) {
    case "connected":
      return `${who} connected ${account}.`;
    case "disconnected":
      return describeDisconnect(entry.code, account, who);
    case "reconnect_needed":
      return `${account} needs reconnecting. ${describeConnectionError(entry.code ?? "", platformName(entry))}`;
    case "draft_approved":
      return `${who} approved ${draft}.`;
    case "draft_rejected":
      return `${who} rejected ${draft}.`;
    case "draft_changed_after_approval":
      return `${who} changed ${draft} after it was approved or scheduled: it needs approving again.`;
    case "draft_archived":
      return `${who} archived ${draft}.`;
    case "draft_restored":
      return `${who} restored ${draft}.`;
    case "idea_planned":
      return `${who} planned the idea ${draft} on the calendar with the AI.`;
    default:
      return null;
  }
}

function describeJobChange(entry: ActivityForText, who: string): string | null {
  const draft = draftName(entry);
  const account = accountName(entry);
  const reason = describeJobError(entry.code ?? "", platformName(entry));
  switch (entry.action) {
    case "scheduled":
      return `${who} scheduled ${draft} for ${account}${entry.code === "auto_rule" ? " under an auto-publish rule, without an approval of its own" : ""}.`;
    case "canceled":
      return `${who} canceled ${draft} on ${account}${cancelReason(entry.code)}.`;
    case "publish_now":
      return `${who} sent ${draft} to ${account} now.`;
    case "published":
      return `${draft} went out on ${account}.`;
    case "publish_failed":
      return `${draft} didn't go out on ${account}. ${reason}`;
    case "publish_delayed":
      return `${draft} waits to go out on ${account}. ${reason} ansa tries again later by itself.`;
    case "needs_attention":
      return `${draft} needs attention on ${account}. ${reason}`;
    case "marked_published":
      return `${who} checked ${platformName(entry)} and marked ${draft} as published on ${account}.`;
    case "marked_not_published":
      return `${who} checked ${platformName(entry)} and marked ${draft} as not published on ${account}.`;
    case "retried":
      return `${who} tried ${draft} again on ${account}.`;
    default:
      return null;
  }
}

function describeRuleOrPlanChange(entry: ActivityForText, who: string): string {
  const rule = entry.rulePlatform ? `${SOCIAL_PLATFORM_LABELS[entry.rulePlatform]}, ${entry.rulePillar ? `pillar “${entry.rulePillar}”` : "every pillar"}` : "a rule";
  switch (entry.action) {
    case "rule_created":
      return `${who} made the auto-publish rule for ${rule} (switched off).`;
    case "rule_enabled":
      return `${who} switched on the auto-publish rule for ${rule}: its posts can go out without an approval of their own.`;
    case "rule_disabled":
      return `${who} switched off the auto-publish rule for ${rule}.`;
    case "plan_created":
      return `${who} made marketing plan version ${entry.planVersion ?? "?"}.`;
    default:
      return `${who}: ${entry.action}.`;
  }
}

// An owner's Disconnect, or the app's when the person behind a LinkedIn
// profile (it posts as them) left or was made a member.
function describeDisconnect(code: string | null, account: string, who: string): string {
  switch (code) {
    case "teammate_removed":
      return `${account} was disconnected: the teammate who connected it was removed.`;
    case "teammate_made_member":
      return `${account} was disconnected: the owner who connected it was made a member.`;
    default:
      return `${who} disconnected ${account}.`;
  }
}

// Why a waiting post was canceled with its draft: who changed the draft.
function cancelReason(code: string | null): string {
  switch (code) {
    case "draft_changed":
      return ", as the draft changed after its approval";
    case "draft_rejected":
      return ", as the draft was rejected";
    case "draft_archived":
      return ", as the draft was archived";
    default:
      return "";
  }
}

function draftName(entry: ActivityForText): string {
  return entry.draftTopic ? `“${entry.draftTopic}”` : "a draft";
}

function accountName(entry: ActivityForText): string {
  if (!entry.connectionPlatform) {
    return "an account";
  }
  const platform = SOCIAL_PLATFORM_LABELS[entry.connectionPlatform];
  return entry.connectionName ? `${platform} (${entry.connectionName})` : platform;
}

function platformName(entry: ActivityForText): string {
  const platform = entry.connectionPlatform ?? entry.draftPlatform;
  return platform ? SOCIAL_PLATFORM_LABELS[platform] : "the platform";
}
