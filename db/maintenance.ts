import "server-only";
import { lt, sql } from "drizzle-orm";
import { db } from "./client";
import { rateLimits, sessions, verifications } from "./schema";

// Housekeeping for tables that belong to no company (rate limit counters and
// Better Auth's sessions and verification links), so no company filter here.

// Deletes rate limit counters whose window ended long ago. The longest window
// is one hour; a day of slack keeps every live counter.
export async function deleteOldRateLimitCounters(): Promise<number> {
  const deleted = await db
    .delete(rateLimits)
    .where(lt(rateLimits.windowStartedAt, sql`now() - interval '1 day'`))
    .returning({ key: rateLimits.key });
  return deleted.length;
}

// Deletes expired logins. Better Auth refuses them anyway; this only frees space.
export async function deleteExpiredSessions(): Promise<number> {
  const deleted = await db.delete(sessions).where(lt(sessions.expiresAt, sql`now()`)).returning({ id: sessions.id });
  return deleted.length;
}

// Deletes expired "confirm your email" links (they no longer work anyway).
export async function deleteExpiredVerifications(): Promise<number> {
  const deleted = await db
    .delete(verifications)
    .where(lt(verifications.expiresAt, sql`now()`))
    .returning({ id: verifications.id });
  return deleted.length;
}
