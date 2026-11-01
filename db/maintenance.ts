import "server-only";
import { and, inArray, lt, sql } from "drizzle-orm";
import { db } from "./client";
import { LINK_CODE_LIFETIME_MINUTES, LINK_WAIT_MINUTES } from "@/lib/telegram";
import { oauthStates, rateLimits, sessions, telegramLinkCodes, telegramPendingConnections, verifications } from "./schema";

// Housekeeping for tables that belong to no company (rate limit counters and
// Better Auth's sessions and verification links), so no company filter here,
// and for expired social connection attempts (step 40) and Telegram link
// codes (step 48): they belong to a company, but once expired nobody can use
// or read one, so they are deleted by age alone, across companies; and for
// Telegram connections no code named within their hour (no company). Nothing
// here reads a row.
//
// Each function deletes at most `limit` rows in one statement and returns how
// many it deleted (the driver's row count: no deleted row is read back).
// services/maintenance.ts repeats them until nothing is left. WHY in batches:
// a flood of logins can leave millions of old counters, and one statement
// deleting them all could run past the job's time limit and be rolled back
// whole, night after night. Each finished batch stays done.
// The age test is repeated outside the batch's subquery so a row that came
// back to life meanwhile (a counter starting a new window) is kept.

// Deletes rate limit counters whose window started more than olderThanSeconds
// ago. The caller passes the longest window plus a day of slack, so every live
// counter stays. make_interval counts exact seconds, unlike interval '1 day',
// which is 23 hours across a daylight-saving change in some time zones.
export async function deleteOldRateLimitCounters(olderThanSeconds: number, limit: number): Promise<number> {
  const isOld = lt(rateLimits.windowStartedAt, sql`now() - make_interval(secs => ${olderThanSeconds})`);
  const oldKeys = db.select({ key: rateLimits.key }).from(rateLimits).where(isOld).limit(limit);
  const result = await db.delete(rateLimits).where(and(inArray(rateLimits.key, oldKeys), isOld));
  return result.rowCount ?? 0;
}

// Deletes expired logins. Better Auth refuses them anyway; this only frees space.
export async function deleteExpiredSessions(limit: number): Promise<number> {
  const isExpired = lt(sessions.expiresAt, sql`now()`);
  const expiredIds = db.select({ id: sessions.id }).from(sessions).where(isExpired).limit(limit);
  const result = await db.delete(sessions).where(and(inArray(sessions.id, expiredIds), isExpired));
  return result.rowCount ?? 0;
}

// Deletes expired password reset links (they no longer work anyway). Email
// confirmation links are signed tokens that are never stored.
export async function deleteExpiredVerifications(limit: number): Promise<number> {
  const isExpired = lt(verifications.expiresAt, sql`now()`);
  const expiredIds = db.select({ id: verifications.id }).from(verifications).where(isExpired).limit(limit);
  const result = await db.delete(verifications).where(and(inArray(verifications.id, expiredIds), isExpired));
  return result.rowCount ?? 0;
}

// Deletes social connection attempts past their 10 minutes, used or not:
// db/oauth-states.ts never accepts one again.
export async function deleteExpiredOauthStates(limit: number): Promise<number> {
  const isExpired = lt(oauthStates.expiresAt, sql`now()`);
  const expiredIds = db.select({ id: oauthStates.id }).from(oauthStates).where(isExpired).limit(limit);
  const result = await db.delete(oauthStates).where(and(inArray(oauthStates.id, expiredIds), isExpired));
  return result.rowCount ?? 0;
}

// Deletes Telegram link codes nobody can use any more: past their 10
// minutes and the hour a claimed one waits for its connection
// (db/telegram-links.ts never accepts one again).
export async function deleteOldTelegramLinkCodes(limit: number): Promise<number> {
  const isOld = lt(telegramLinkCodes.expiresAt, sql`now() - make_interval(mins => ${LINK_WAIT_MINUTES})`);
  const oldIds = db.select({ id: telegramLinkCodes.id }).from(telegramLinkCodes).where(isOld).limit(limit);
  const result = await db.delete(telegramLinkCodes).where(and(inArray(telegramLinkCodes.id, oldIds), isOld));
  return result.rowCount ?? 0;
}

// Deletes Telegram connections that waited their hour for a code in vain
// (and a little longer: a code lives 10 minutes).
export async function deleteOldTelegramPendingConnections(limit: number): Promise<number> {
  const isOld = lt(telegramPendingConnections.receivedAt, sql`now() - make_interval(mins => ${LINK_WAIT_MINUTES + LINK_CODE_LIFETIME_MINUTES})`);
  const oldIds = db.select({ id: telegramPendingConnections.externalId }).from(telegramPendingConnections).where(isOld).limit(limit);
  const result = await db.delete(telegramPendingConnections).where(and(inArray(telegramPendingConnections.externalId, oldIds), isOld));
  return result.rowCount ?? 0;
}
