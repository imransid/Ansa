import "server-only";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { SocialConnectionStatus, SocialPlatform } from "@/lib/social-platforms";
import { db, type DbTransaction } from "./client";
import { recordActivity } from "./cofounder-activity";
import { socialConnections } from "./schema";

// The tokens of one company's social connection, for the one service that
// uses them before a platform call (services/social-tokens.ts): the claim
// that lets one run at a time renew them, and the three ways that service
// writes back, each ending the claim. Never for a page.
//
// WHY every write names the access token it replaces: a renewal can take
// seconds, and meanwhile an owner may disconnect or reconnect the account,
// or another run may renew it first. The write then matches nothing, and
// what happened meanwhile stands: a disconnect is never undone by a late
// renewal, and a newer token is never replaced by an older one. (A fresh
// encryption never repeats: each has its own random IV.)

// A claim this old belongs to a run that died: a renewal is one request
// of at most 15 seconds (lib/social-http.ts, API_TIMEOUT_MS).
const RENEWAL_CLAIM_SECONDS = 60;

export type ConnectionWithTokens = {
  id: string;
  platform: SocialPlatform;
  externalAccountId: string;
  status: SocialConnectionStatus;
  lastError: string | null;
  isStandIn: boolean;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  accessExpiresAt: Date | null;
  refreshExpiresAt: Date | null;
};

export type RenewedTokens = {
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  accessExpiresAt: Date | null;
  refreshExpiresAt: Date | null;
};

// One of the company's connections with its encrypted tokens, or null.
export async function getConnectionWithTokens(companyId: string, connectionId: string): Promise<ConnectionWithTokens | null> {
  const [connection] = await db
    .select({
      id: socialConnections.id,
      platform: socialConnections.platform,
      externalAccountId: socialConnections.externalAccountId,
      status: socialConnections.status,
      lastError: socialConnections.lastError,
      isStandIn: socialConnections.isStandIn,
      accessTokenEncrypted: socialConnections.accessTokenEncrypted,
      refreshTokenEncrypted: socialConnections.refreshTokenEncrypted,
      accessExpiresAt: socialConnections.accessExpiresAt,
      refreshExpiresAt: socialConnections.refreshExpiresAt,
    })
    .from(socialConnections)
    .where(and(eq(socialConnections.companyId, companyId), eq(socialConnections.id, connectionId)));
  return connection ?? null;
}

// Claims the renewal for this run, in one UPDATE, while the connection is
// connected, still holds this token and no other run is renewing it.
// False: another run is (or the token changed meanwhile).
export async function claimRenewal(companyId: string, connectionId: string, accessTokenEncrypted: string): Promise<boolean> {
  const noRenewalRunning = or(
    isNull(socialConnections.renewalStartedAt),
    lt(socialConnections.renewalStartedAt, sql`now() - make_interval(secs => ${RENEWAL_CLAIM_SECONDS})`),
  );
  const claimed = await db
    .update(socialConnections)
    .set({ renewalStartedAt: sql`now()` })
    .where(and(stillHolding(companyId, connectionId, accessTokenEncrypted), noRenewalRunning))
    .returning({ id: socialConnections.id });
  return claimed.length > 0;
}

// Saves renewed tokens in one UPDATE, and clears the last problem, while
// the connection is connected and still holds the token they replace.
export async function saveRenewedTokens(companyId: string, connectionId: string, replacedAccessTokenEncrypted: string, renewed: RenewedTokens): Promise<boolean> {
  const saved = await db
    .update(socialConnections)
    .set({
      accessTokenEncrypted: renewed.accessTokenEncrypted,
      refreshTokenEncrypted: renewed.refreshTokenEncrypted,
      accessExpiresAt: renewed.accessExpiresAt,
      refreshExpiresAt: renewed.refreshExpiresAt,
      lastError: null,
      renewalStartedAt: null,
      updatedAt: sql`now()`,
    })
    .where(stillHolding(companyId, connectionId, replacedAccessTokenEncrypted))
    .returning({ id: socialConnections.id });
  return saved.length > 0;
}

// Marks a connection as needing a reconnect, saying why, while it is
// connected and still holds this token, and records it in the activity log
// (step 41). Its tokens stay (a later Disconnect still asks the platform to
// take them back).
export async function markNeedsReauth(companyId: string, connectionId: string, accessTokenEncrypted: string, code: string): Promise<boolean> {
  return db.transaction((tx) => markNeedsReauthWithin(tx, companyId, connectionId, accessTokenEncrypted, code));
}

// The same inside the caller's transaction: a post the platform refused the
// token for is failed and its connection marked together (db/publish-runs.ts).
export async function markNeedsReauthWithin(
  tx: DbTransaction,
  companyId: string,
  connectionId: string,
  accessTokenEncrypted: string,
  code: string,
): Promise<boolean> {
  const marked = await tx
    .update(socialConnections)
    .set({ status: "needs_reauth", lastError: code, renewalStartedAt: null, updatedAt: sql`now()` })
    .where(stillHolding(companyId, connectionId, accessTokenEncrypted))
    .returning({ id: socialConnections.id });
  if (marked.length === 0) {
    return false;
  }
  await recordActivity(tx, companyId, [{ action: "reconnect_needed", actorUserId: null, connectionId: marked[0].id, code }]);
  return true;
}

// Notes a passing problem (the platform didn't answer a renewal) while the
// connection still holds this token; it stays usable.
export async function recordConnectionProblem(companyId: string, connectionId: string, accessTokenEncrypted: string, code: string): Promise<boolean> {
  const recorded = await db
    .update(socialConnections)
    .set({ lastError: code, renewalStartedAt: null, updatedAt: sql`now()` })
    .where(stillHolding(companyId, connectionId, accessTokenEncrypted))
    .returning({ id: socialConnections.id });
  return recorded.length > 0;
}

function stillHolding(companyId: string, connectionId: string, accessTokenEncrypted: string) {
  return and(
    eq(socialConnections.companyId, companyId),
    eq(socialConnections.id, connectionId),
    eq(socialConnections.status, "connected"),
    eq(socialConnections.accessTokenEncrypted, accessTokenEncrypted),
  );
}
