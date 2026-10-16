import "server-only";
import { createHash } from "node:crypto";
import { recordAttemptAndCount } from "@/db/rate-limits";

type RateLimitRule = {
  maxAttempts: number;
  windowSeconds: number;
};

export const RATE_LIMITS = {
  signupPerIp: { maxAttempts: 10, windowSeconds: 60 * 60 },
  loginPerIp: { maxAttempts: 20, windowSeconds: 15 * 60 },
  loginPerEmail: { maxAttempts: 10, windowSeconds: 15 * 60 },
  inviteChangesPerCompany: { maxAttempts: 30, windowSeconds: 60 * 60 },
  invitePreviewPerIp: { maxAttempts: 30, windowSeconds: 15 * 60 },
  ticketChangesPerUser: { maxAttempts: 120, windowSeconds: 10 * 60 },
  vapiWebhookPerIp: { maxAttempts: 600, windowSeconds: 60 },
  // Categories and who handles them (Team page).
  settingsChangesPerUser: { maxAttempts: 60, windowSeconds: 10 * 60 },
  // Each analysis is a paid Claude call.
  callAnalysisPerUser: { maxAttempts: 20, windowSeconds: 10 * 60 },
} satisfies Record<string, RateLimitRule>;

// Counts one attempt and returns true when the caller has gone over the limit.
export async function isOverRateLimit(
  action: string,
  identifier: string,
  rule: RateLimitRule,
): Promise<boolean> {
  // Hash the key so raw IP addresses and emails are never stored in the database.
  const key = createHash("sha256")
    .update(`${action}:${identifier}`)
    .digest("hex");

  const attempts = await recordAttemptAndCount(key, rule.windowSeconds);
  return attempts > rule.maxAttempts;
}
