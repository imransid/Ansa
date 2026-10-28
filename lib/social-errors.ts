// The short codes of social accounts (step 40), never a platform's message,
// with the plain words the pages show for them. Safe to log and to put in
// an address: none holds a token, a name or anything a platform wrote.

// What became of one "Connect": the callback puts it in the Accounts
// page's address (/cofounder/accounts?result=...&platform=...).
export const connectResults = [
  "connected",
  // The person said no on the platform's consent screen.
  "denied",
  // The platform sent another error back instead of permission.
  "provider_error",
  "missing_code",
  // The state was unknown, used, expired, or another person's.
  "expired_state",
  "not_owner",
  "not_set_up",
  // The platform didn't confirm the code, or its answers were unreadable.
  "exchange_failed",
  // Facebook: no Page the person may post to. YouTube: no channel.
  "no_pages",
  "no_channel",
  // The person unticked a permission ansa needs to post.
  "missing_permission",
  "rate_limited",
] as const;
export type ConnectResult = (typeof connectResults)[number];
export type ConnectFailureCode = Exclude<ConnectResult, "connected">;

// Why a connection needs attention (social_connections.last_error).
export const connectionErrorCodes = [
  // LinkedIn's 60 days ran out, and LinkedIn renews tokens only for its partners.
  "token_expired",
  "refresh_expired",
  // The platform refused to renew it (removed in its settings, a password
  // change, Google's 7-day limit while ansa's app is in Testing).
  "refresh_refused",
  // The platform didn't answer when ansa tried to renew it; tried again next time.
  "refresh_unavailable",
  // The platform refused the token itself when ansa used it (step 41).
  "token_rejected",
] as const;
export type ConnectionErrorCode = (typeof connectionErrorCodes)[number];

// Why a post wasn't published (not_created: nothing went out), or why it is
// unclear whether it was (lib/social-publishing.ts, PublishResult).
export const publishErrorCodes = [
  "duplicate",
  "rate_limited",
  "quota_exceeded",
  "token_rejected",
  "permission_denied",
  "invalid_request",
  "not_found",
  "conflict",
  "unprocessable",
  "blocked_by_policy",
  "link_error",
  "refused",
  "media_type_not_accepted",
  "media_too_large",
  "video_not_supported",
  "text_posts_not_supported",
  "title_missing",
  "upload_failed",
  "upload_url_refused",
  "upload_session_expired",
  "stand_in_in_production",
  // The development stand-in couldn't write its file (a read-only disk).
  "stand_in_write_failed",
  "not_set_up",
  // Unclear outcomes: the post may have gone out.
  "server_error",
  "temporary_error",
  "timeout",
  "network_error",
  "no_post_id",
  "upload_interrupted",
  // An answer of a kind the platform's docs don't list.
  "unexpected_answer",
] as const;
export type PublishErrorCode = (typeof publishErrorCodes)[number];

// The Accounts page's words for one connection's result. count: how many
// accounts were connected (Facebook connects every Page at once).
export function describeConnectResult(result: ConnectResult, platformLabel: string, count: number | null): string {
  switch (result) {
    case "connected":
      return count !== null && count > 1 ? `Connected ${count} ${platformLabel} Pages.` : `Connected to ${platformLabel}.`;
    case "denied":
      return `${platformLabel} says the connection was cancelled, so nothing was connected.`;
    case "provider_error":
      return `${platformLabel} refused the connection, so nothing was connected. Try again, or tell ansa if it keeps happening.`;
    case "missing_code":
      return `${platformLabel} sent back no permission, so nothing was connected. Try again.`;
    case "expired_state":
      return "That connection link has expired, was already used, or was started by someone else. Press Connect again.";
    case "not_owner":
      return "Only owners can connect accounts.";
    case "not_set_up":
      return `${platformLabel} isn't set up by ansa yet.`;
    case "exchange_failed":
      return `${platformLabel} didn't confirm the connection, so nothing was connected. Try again in a few minutes.`;
    case "no_pages":
      return "Facebook says you manage no Page you may post to, so nothing was connected. Ask the Page's admin for a role that can create content, then connect again.";
    case "no_channel":
      return "Google says this account has no YouTube channel, so nothing was connected. Create the channel first, or pick the account that has it.";
    case "missing_permission":
      return `You left out a permission ansa needs to post, so nothing was connected. Connect again and keep every permission ${platformLabel} asks for.`;
    case "rate_limited":
      return "Too many attempts. Try again in a few minutes.";
  }
}

// The Accounts page's words for a connection's last error. A code this
// version doesn't know (written by a later one) is shown as it is.
export function describeConnectionError(code: string, platformLabel: string): string {
  switch (code) {
    case "token_expired":
      return `${platformLabel}'s permission ran out (it lasts 60 days and can't be renewed without you). Reconnect to keep posting.`;
    case "refresh_expired":
      return `${platformLabel}'s permission ran out. Reconnect to keep posting.`;
    case "refresh_refused":
      return `${platformLabel} no longer accepts ansa's permission (it may have been removed in ${platformLabel}'s settings). Reconnect to keep posting.`;
    case "refresh_unavailable":
      return `${platformLabel} didn't answer when ansa last renewed its permission. ansa tries again the next time it needs it.`;
    case "token_rejected":
      return `${platformLabel} refused ansa's permission the last time it was used. Reconnect to keep posting.`;
    default:
      return `Something went wrong the last time ansa used it (${code}).`;
  }
}

export function isConnectResult(value: string): value is ConnectResult {
  return (connectResults as readonly string[]).includes(value);
}
