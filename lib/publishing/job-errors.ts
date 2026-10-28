import type { PublishErrorCode } from "@/lib/social-errors";

// Why a publish job (step 41) didn't go out, or why it is unclear whether it
// did: publish_jobs.last_error. Short codes, never a platform's message, with
// the plain words the pages show. Besides the platforms' own codes
// (lib/social-errors.ts, publishErrorCodes), the queue's: what the check
// right before sending found, getting the account ready, and the runner.
export const publishJobErrorCodes = [
  // The check right before sending (lib/publishing/run-check.ts): nothing was sent.
  "draft_changed",
  "draft_rejected",
  "draft_archived",
  "approval_no_longer_valid",
  "approver_not_owner",
  "rule_disabled",
  "rule_owner_gone",
  "draft_has_problems",
  "claims_not_checked",
  "account_disconnected",
  "account_needs_reconnect",
  "wrong_account",
  "format_not_published",
  "media_missing",
  // Getting the account's permission ready (services/social-tokens.ts).
  "reauthorization_needed",
  "token_refresh_unavailable",
  "account_unreadable",
  "platform_not_set_up",
  // The runner: a run cut off while sending (needs attention), the
  // company's daily limit (waits), storage not answering (tried again), a
  // run too slow to reach the platform in time (back in the queue).
  "interrupted",
  "daily_limit",
  "media_unavailable",
  "run_too_slow",
] as const;
export type PublishJobErrorCode = (typeof publishJobErrorCodes)[number] | PublishErrorCode;

// The queue's words for a job's last_error. A code this version doesn't
// know (written by a later one) is shown as it is.
export function describeJobError(code: string, platformLabel: string): string {
  return describeQueueCode(code, platformLabel) ?? describePlatformCode(code, platformLabel) ?? `Something went wrong (${code}).`;
}

function describeQueueCode(code: string, platform: string): string | null {
  switch (code) {
    case "draft_changed":
      return "The draft changed after this post was scheduled, so it was not sent: approve and schedule the new version.";
    case "draft_rejected":
      return "An owner rejected the draft after this post was scheduled, so it was not sent.";
    case "draft_archived":
      return "The draft was archived after this post was scheduled, so it was not sent.";
    case "approval_no_longer_valid":
      return "The draft's approval was taken away after this post was scheduled, so it was not sent.";
    case "approver_not_owner":
      return "The owner who approved the draft is no longer an owner of the company, so it was not sent: an owner approves it again.";
    case "rule_disabled":
      return "The auto-publish rule this post went under is off, so it was not sent: an owner approves the draft to send it.";
    case "rule_owner_gone":
      return "The owner behind the auto-publish rule is no longer an owner of the company, so it was not sent.";
    case "draft_has_problems":
      return "The draft breaks one of its platform's rules or uses a word to avoid (perhaps one confirmed since), so it was not sent: fix it on the draft's page.";
    case "claims_not_checked":
      return "A claim in the draft isn't backed by a confirmed fact, or the text was changed by hand, so the auto-publish rule couldn't send it: an owner checks and approves it.";
    case "account_disconnected":
      return `The ${platform} account was disconnected, so nothing was sent.`;
    case "account_needs_reconnect":
    case "reauthorization_needed":
      return `${platform} no longer accepts ansa's permission for this account, so nothing was sent: reconnect it on the Accounts page, then retry.`;
    case "wrong_account":
      return "The account is on another platform than the draft, so nothing was sent.";
    case "format_not_published":
      return `ansa can't publish this kind of post to ${platform} yet, so nothing was sent.`;
    case "media_missing":
      return "The draft's image or video is missing, so nothing was sent.";
    case "token_refresh_unavailable":
      return `${platform} didn't answer when ansa renewed its permission, so nothing was sent.`;
    case "account_unreadable":
      return "ansa couldn't read the account's stored permission, so nothing was sent. Contact ansa if it keeps happening.";
    case "platform_not_set_up":
    case "not_set_up":
      return `${platform} isn't set up by ansa yet, so nothing was sent.`;
    case "interrupted":
      return `The run sending this post was cut off, so ansa can't tell whether it went out: check the account on ${platform}.`;
    case "daily_limit":
      return "Your company reached its number of posts for the day: this one goes out later by itself.";
    case "media_unavailable":
      return "ansa couldn't read the draft's image or video from storage, so nothing was sent.";
    case "run_too_slow":
      return `The last try took too long to reach ${platform}, so nothing was sent.`;
    default:
      return null;
  }
}

// The platforms' own codes (lib/social-errors.ts). The last group are the
// unclear ones: the platform may have made the post.
function describePlatformCode(code: string, platform: string): string | null {
  switch (code) {
    case "duplicate":
      return `${platform} refused the post as a duplicate of a recent one.`;
    case "rate_limited":
      return `${platform} asked ansa to slow down.`;
    case "quota_exceeded":
      return `${platform}'s daily limit for ansa was reached.`;
    case "token_rejected":
      return `${platform} refused ansa's permission for this account: reconnect it on the Accounts page.`;
    case "permission_denied":
      return `${platform} says the account may not post this.`;
    case "invalid_request":
    case "unprocessable":
    case "conflict":
    case "refused":
      return `${platform} refused the post as it was sent.`;
    case "not_found":
      return `${platform} couldn't find the account.`;
    case "blocked_by_policy":
      return `${platform} blocked the post under its rules.`;
    case "link_error":
      return `${platform} couldn't read a link in the post.`;
    case "media_type_not_accepted":
      return `${platform} doesn't take this kind of image or video.`;
    case "media_too_large":
      return `The image or video is too large for ${platform}.`;
    case "video_not_supported":
      return `ansa can't send videos to ${platform} yet.`;
    case "text_posts_not_supported":
      return `${platform} takes videos only.`;
    case "title_missing":
      return "The video needs a title.";
    case "upload_failed":
      return `The upload to ${platform} didn't start, so nothing was sent.`;
    case "upload_url_refused":
      return `${platform} named an upload address ansa doesn't trust, so nothing was sent.`;
    case "upload_session_expired":
      return `The upload session at ${platform} ran out before the video arrived.`;
    case "stand_in_in_production":
      return "A development stand-in account can't publish on this server.";
    case "stand_in_write_failed":
      return "The development stand-in couldn't write its file.";
    case "server_error":
    case "temporary_error":
    case "unexpected_answer":
      return `${platform} answered with a problem while posting: it may or may not have made the post.`;
    case "timeout":
      return `${platform} didn't answer in time: it may or may not have made the post.`;
    case "network_error":
      return `The connection to ${platform} broke while posting: it may or may not have made the post.`;
    case "no_post_id":
      return `${platform} answered without the post's id: it may or may not have made the post.`;
    case "upload_interrupted":
      return `The upload to ${platform} was cut off: the video may or may not be there.`;
    default:
      return null;
  }
}
