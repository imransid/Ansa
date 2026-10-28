import "server-only";
import { pingDatabase } from "@/db/health";
import { getClientIpFromHeaders } from "@/lib/request-ip";
import { describeErrorWithFrames } from "@/lib/safe-error-logging";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Answers an uptime monitor (GET /api/health): 200 while the app can reach its
// database, 503 when it can't, 429 when one address asks too often. Never a
// body or any other detail: anyone can call it. Never throws. ping is only
// replaced by the checks.
export async function handleHealthCheck(request: Request, ping: () => Promise<void> = pingDatabase): Promise<Response> {
  try {
    if (await isOverRateLimit("health", getClientIpFromHeaders(request.headers), RATE_LIMITS.healthChecksPerIp)) {
      return emptyResponse(429);
    }
    await ping();
    return emptyResponse(200);
  } catch (error) {
    // The rate limit counter is in the database too, so a database outage
    // lands here from either step. No customer data passes through here.
    console.error(`Health check failed: ${describeErrorWithFrames(error)}`);
    return emptyResponse(503);
  }
}

// No body, and never cached: every check must reach the database.
function emptyResponse(status: number): Response {
  return new Response(null, { status, headers: { "cache-control": "no-store" } });
}
