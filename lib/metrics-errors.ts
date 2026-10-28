// Why a post's numbers weren't read (step 42): publish_jobs.metrics_error,
// a short code, never a platform's message, with the plain words the
// Analytics page shows. Safe to log: none holds a token or anything a
// platform wrote.
export const metricsErrorCodes = [
  // The platform gives these numbers only with a permission ansa doesn't ask for.
  "needs_permission",
  // A development stand-in account: its numbers come from pnpm simulate:post-metrics only.
  "stand_in",
  "not_set_up",
  // Getting the account ready (services/social-tokens.ts): nothing was asked.
  "reauthorization_needed",
  "account_disconnected",
  "token_refresh_unavailable",
  "account_unreadable",
  // The platform's answer.
  "token_rejected",
  "permission_denied",
  "not_found",
  "rate_limited",
  "quota_exceeded",
  "invalid_request",
  "server_error",
  "timeout",
  "network_error",
  "unexpected_answer",
  // An answer without a single number in it.
  "no_numbers",
] as const;
export type MetricsErrorCode = (typeof metricsErrorCodes)[number];

// The Analytics page's words for a post's metrics_error. A code this
// version doesn't know (written by a later one) is shown as it is.
export function describeMetricsError(code: string, platformLabel: string): string {
  switch (code) {
    case "needs_permission":
      return `${platformLabel} gives these numbers only with a permission ansa doesn't have yet.`;
    case "stand_in":
      return "A development stand-in account: its numbers come only from pnpm simulate:post-metrics.";
    case "not_set_up":
      return `${platformLabel} isn't set up by ansa on this server, so its numbers can't be read.`;
    case "reauthorization_needed":
      return `${platformLabel} no longer accepts ansa's permission for this account: reconnect it on the Accounts page.`;
    case "account_disconnected":
      return "The account was disconnected, so its numbers are no longer read.";
    case "token_refresh_unavailable":
      return `${platformLabel} didn't answer when ansa renewed its permission. ansa tries again tomorrow.`;
    case "account_unreadable":
      return "ansa couldn't read the account's stored permission. Contact ansa if it keeps happening.";
    case "token_rejected":
      return `${platformLabel} refused ansa's permission for this account: reconnect it on the Accounts page.`;
    case "permission_denied":
      return `${platformLabel} says this account may not read the post's numbers.`;
    case "not_found":
      return `${platformLabel} can't find the post any more (it may have been deleted there).`;
    case "rate_limited":
    case "quota_exceeded":
      return `${platformLabel} asked ansa to slow down. ansa tries again tomorrow.`;
    case "invalid_request":
      return `${platformLabel} refused the request for the post's numbers.`;
    case "server_error":
    case "timeout":
    case "network_error":
      return `${platformLabel} didn't answer properly when ansa asked. ansa tries again tomorrow.`;
    case "unexpected_answer":
    case "no_numbers":
      return `${platformLabel}'s answer held no numbers ansa could read. ansa tries again tomorrow.`;
    default:
      return `The numbers couldn't be read (${code}).`;
  }
}
