import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { deleteExpiredSessions, deleteExpiredVerifications, deleteOldRateLimitCounters } from "@/db/maintenance";
import { env } from "@/lib/env";
import { getClientIpFromHeaders } from "@/lib/request-ip";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

export type CleanupCounts = {
  rateLimitCounters: number;
  sessions: number;
  verifications: number;
};

// Answers the daily cleanup call: 404 when no CRON_SECRET is set, 401 for a
// wrong or missing secret, otherwise runs the cleanup. Never throws.
// cronSecret is only passed by the checks.
export async function handleCleanupRequest(request: Request, cronSecret = env.CRON_SECRET): Promise<Response> {
  try {
    if (!cronSecret) {
      return new Response(null, { status: 404 });
    }
    if (await isOverRateLimit("cron", getClientIpFromHeaders(request.headers), RATE_LIMITS.cronPerIp)) {
      return new Response(null, { status: 429 });
    }
    if (!isCorrectSecret(request.headers.get("authorization"), cronSecret)) {
      console.warn("Cleanup rejected: invalid secret");
      return new Response(null, { status: 401 });
    }
    return Response.json(await runCleanup(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error(`Cleanup failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    return new Response(null, { status: 500 });
  }
}

// Deletes data nobody can use any more. Safe to run any number of times.
export async function runCleanup(): Promise<CleanupCounts> {
  return {
    rateLimitCounters: await deleteOldRateLimitCounters(),
    sessions: await deleteExpiredSessions(),
    verifications: await deleteExpiredVerifications(),
  };
}

function isCorrectSecret(authorization: string | null, secret: string): boolean {
  // Hashing first gives equal lengths, which timingSafeEqual needs, and the
  // comparison takes the same time whatever was sent.
  const sent = createHash("sha256").update(authorization ?? "").digest();
  const expected = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(sent, expected);
}
