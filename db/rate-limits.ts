import "server-only";
import { sql } from "drizzle-orm";
import { db } from "./client";
import { rateLimits } from "./schema";

// Records one attempt for this key and returns how many attempts are in the
// current window (including this one). Starts a fresh window when the old one ran out.
export async function recordAttemptAndCount(
  key: string,
  windowSeconds: number,
): Promise<number> {
  const windowHasExpired = sql`${rateLimits.windowStartedAt} < now() - make_interval(secs => ${windowSeconds})`;

  // One INSERT ... ON CONFLICT statement does the read and the write together,
  // so two requests arriving at the same moment cannot both slip under the limit.
  const [row] = await db
    .insert(rateLimits)
    .values({ key, attemptCount: 1, windowStartedAt: sql`now()` })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        attemptCount: sql`CASE WHEN ${windowHasExpired} THEN 1 ELSE ${rateLimits.attemptCount} + 1 END`,
        windowStartedAt: sql`CASE WHEN ${windowHasExpired} THEN now() ELSE ${rateLimits.windowStartedAt} END`,
      },
    })
    .returning({ attemptCount: rateLimits.attemptCount });

  return row.attemptCount;
}
