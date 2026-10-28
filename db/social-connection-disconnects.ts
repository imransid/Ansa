import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { canManageSocialAccounts } from "@/lib/cofounder/permissions";
import type { SocialPlatform } from "@/lib/social-platforms";
import { db, type DbTransaction } from "./client";
import { recordActivity } from "./cofounder-activity";
import { lockActiveAuthorRole } from "./knowledge-author";
import { socialConnections } from "./schema";

// Disconnecting one company's social accounts (step 40): by an owner on the
// Accounts page, and, inside a teammate's removal or an owner being made a
// member, the LinkedIn profiles they connected. The tokens go; the row stays, as "disconnected", for
// history, and the activity log records it (step 41). The owner's role is
// read again, locked, in the transaction (db/knowledge-author.ts says why).
// Posts waiting for a disconnected account fail when they run
// (lib/publishing/run-check.ts).

export type DisconnectOutcome =
  | {
      outcome: "disconnected";
      platform: SocialPlatform;
      externalAccountId: string;
      isStandIn: boolean;
      accessTokenEncrypted: string | null;
      refreshTokenEncrypted: string | null;
    }
  | { outcome: "not-found" | "already-disconnected" | "not-allowed" };

// Disconnects one of the company's connections while actorUserId is an
// active owner: its tokens deleted, the row kept as "disconnected". Returns
// the tokens it took off (still encrypted) and whose they were, for the
// best-effort revoke after commit; nothing else ever reads a disconnected
// connection's tokens.
export async function disconnectSocialConnection(companyId: string, actorUserId: string, connectionId: string): Promise<DisconnectOutcome> {
  return db.transaction(async (tx) => {
    const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
    if (!role || !canManageSocialAccounts(role)) {
      return { outcome: "not-allowed" };
    }
    const [current] = await tx
      .select({
        status: socialConnections.status,
        platform: socialConnections.platform,
        externalAccountId: socialConnections.externalAccountId,
        isStandIn: socialConnections.isStandIn,
        accessTokenEncrypted: socialConnections.accessTokenEncrypted,
        refreshTokenEncrypted: socialConnections.refreshTokenEncrypted,
      })
      .from(socialConnections)
      .where(and(eq(socialConnections.companyId, companyId), eq(socialConnections.id, connectionId)))
      .for("update");
    if (!current) {
      return { outcome: "not-found" };
    }
    if (current.status === "disconnected") {
      return { outcome: "already-disconnected" };
    }
    await tx
      .update(socialConnections)
      .set(disconnectedColumns())
      .where(and(eq(socialConnections.companyId, companyId), eq(socialConnections.id, connectionId), ne(socialConnections.status, "disconnected")));
    await recordActivity(tx, companyId, [{ action: "disconnected", actorUserId, connectionId }]);
    return {
      outcome: "disconnected",
      platform: current.platform,
      externalAccountId: current.externalAccountId,
      isStandIn: current.isStandIn,
      accessTokenEncrypted: current.accessTokenEncrypted,
      refreshTokenEncrypted: current.refreshTokenEncrypted,
    };
  });
}

// Inside a teammate's removal (db/teammate-access.ts) or an owner being made
// a member (db/team-members.ts): disconnects the LinkedIn member profiles
// they connected. Those post AS that person, and their own profile must not
// keep posting for the company once they can neither cancel its posts nor
// disconnect it (members can't, step 41). Pages, channels and X accounts
// belong to the business and stay. The log records it as the app's doing
// (actor empty), like the tickets taken off them, with why.
export async function disconnectMemberProfilesOf(
  tx: DbTransaction,
  companyId: string,
  userId: string,
  why: "teammate_removed" | "teammate_made_member",
): Promise<void> {
  const disconnected = await tx
    .update(socialConnections)
    .set(disconnectedColumns())
    .where(
      and(
        eq(socialConnections.companyId, companyId),
        eq(socialConnections.connectedByUserId, userId),
        eq(socialConnections.accountKind, "member"),
        ne(socialConnections.status, "disconnected"),
      ),
    )
    .returning({ id: socialConnections.id });
  await recordActivity(
    tx,
    companyId,
    disconnected.map((connection) => ({ action: "disconnected" as const, actorUserId: null, connectionId: connection.id, code: why })),
  );
}

// What a disconnected connection holds: no token, no expiry, no renewal
// claim, when it ended.
function disconnectedColumns() {
  return {
    status: "disconnected" as const,
    accessTokenEncrypted: null,
    refreshTokenEncrypted: null,
    accessExpiresAt: null,
    refreshExpiresAt: null,
    lastError: null,
    renewalStartedAt: null,
    disconnectedAt: sql`now()`,
    updatedAt: sql`now()`,
  };
}
