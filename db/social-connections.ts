import "server-only";
import { and, eq, inArray, sql, TransactionRollbackError } from "drizzle-orm";
import { canManageSocialAccounts } from "@/lib/cofounder/permissions";
import type { SocialAccountKind, SocialConnectionStatus, SocialPlatform } from "@/lib/social-platforms";
import { db, type DbTransaction } from "./client";
import { recordActivity } from "./cofounder-activity";
import { lockActiveAuthorRole } from "./knowledge-author";
import { socialConnections, users } from "./schema";

// One company's social accounts (step 40): the list for the Accounts page
// (never a token) and saving connected accounts. Tokens are encrypted by
// the services before they get here; disconnecting is
// db/social-connection-disconnects.ts, renewing tokens
// db/social-connection-tokens.ts. Only an active owner connects: the role
// is read again, locked, in the transaction (db/knowledge-author.ts says why).

export type SocialConnectionListItem = {
  id: string;
  platform: SocialPlatform;
  displayName: string;
  accountKind: SocialAccountKind;
  scopes: string[];
  status: SocialConnectionStatus;
  lastError: string | null;
  accessExpiresAt: Date | null;
  // Whether the platform gave a refresh token (never the token itself),
  // and when that one ends, if the platform said.
  hasRefreshToken: boolean;
  refreshExpiresAt: Date | null;
  isStandIn: boolean;
  connectedAt: Date;
  connectedByName: string | null;
  disconnectedAt: Date | null;
};

// An account to save, its tokens encrypted for the connection id it names.
export type ConnectionToSave = {
  id: string;
  externalAccountId: string;
  displayName: string;
  accountKind: SocialAccountKind;
  scopes: string[];
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  accessExpiresAt: Date | null;
  refreshExpiresAt: Date | null;
};

// Lists one company's connections, with who connected each. The token
// columns are never selected.
export async function listSocialConnections(companyId: string): Promise<SocialConnectionListItem[]> {
  return db
    .select({
      id: socialConnections.id,
      platform: socialConnections.platform,
      displayName: socialConnections.displayName,
      accountKind: socialConnections.accountKind,
      scopes: socialConnections.scopes,
      status: socialConnections.status,
      lastError: socialConnections.lastError,
      accessExpiresAt: socialConnections.accessExpiresAt,
      hasRefreshToken: sql<boolean>`${socialConnections.refreshTokenEncrypted} IS NOT NULL`,
      refreshExpiresAt: socialConnections.refreshExpiresAt,
      isStandIn: socialConnections.isStandIn,
      connectedAt: socialConnections.connectedAt,
      connectedByName: users.name,
      disconnectedAt: socialConnections.disconnectedAt,
    })
    .from(socialConnections)
    .leftJoin(users, and(eq(users.id, socialConnections.connectedByUserId), eq(users.companyId, socialConnections.companyId)))
    .where(eq(socialConnections.companyId, companyId))
    .orderBy(socialConnections.platform, socialConnections.displayName, socialConnections.id);
}

// The ids of one company's connections of these accounts, by the
// platform's account id: reconnecting an account keeps its row and id.
export async function findConnectionIds(companyId: string, platform: SocialPlatform, externalAccountIds: string[]): Promise<Map<string, string>> {
  if (externalAccountIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ id: socialConnections.id, externalAccountId: socialConnections.externalAccountId })
    .from(socialConnections)
    .where(and(eq(socialConnections.companyId, companyId), eq(socialConnections.platform, platform), inArray(socialConnections.externalAccountId, externalAccountIds)));
  return new Map(rows.map((row) => [row.externalAccountId, row.id]));
}

// Saves connected accounts while actorUserId is an active owner: a new row
// for an account never connected, the same row for one connected before
// (connected again, by this owner, with the new tokens), each recorded in
// the activity log (step 41). All of them or none. "changed": an account
// got a row under another id meanwhile (two connections of it at once), and
// its tokens were encrypted for the id named here, so nothing is saved: the
// caller tries again.
export async function saveSocialConnections(
  companyId: string,
  actorUserId: string,
  platform: SocialPlatform,
  isStandIn: boolean,
  connections: ConnectionToSave[],
): Promise<"saved" | "not-allowed" | "changed"> {
  try {
    return await db.transaction(async (tx) => {
      const role = await lockActiveAuthorRole(tx, companyId, actorUserId);
      if (!role || !canManageSocialAccounts(role)) {
        return "not-allowed";
      }
      for (const connection of connections) {
        if (!(await saveOneConnection(tx, companyId, actorUserId, platform, isStandIn, connection))) {
          tx.rollback();
        }
      }
      await recordActivity(
        tx,
        companyId,
        connections.map((connection) => ({ action: "connected" as const, actorUserId, connectionId: connection.id })),
      );
      return "saved";
    });
  } catch (error) {
    if (error instanceof TransactionRollbackError) {
      return "changed";
    }
    throw error;
  }
}

// Every column named (never a spread of what was passed in). True when the
// row was written; false when the account's row has another id.
async function saveOneConnection(
  tx: DbTransaction,
  companyId: string,
  actorUserId: string,
  platform: SocialPlatform,
  isStandIn: boolean,
  connection: ConnectionToSave,
): Promise<boolean> {
  const fresh = {
    displayName: connection.displayName,
    accountKind: connection.accountKind,
    scopes: connection.scopes,
    accessTokenEncrypted: connection.accessTokenEncrypted,
    refreshTokenEncrypted: connection.refreshTokenEncrypted,
    accessExpiresAt: connection.accessExpiresAt,
    refreshExpiresAt: connection.refreshExpiresAt,
    status: "connected" as const,
    lastError: null,
    // A renewal of the old tokens running now saves nothing over these.
    renewalStartedAt: null,
    connectedByUserId: actorUserId,
    connectedAt: sql`now()`,
    disconnectedAt: null,
    updatedAt: sql`now()`,
    isStandIn,
  };
  const saved = await tx
    .insert(socialConnections)
    .values({ id: connection.id, companyId, platform, externalAccountId: connection.externalAccountId, ...fresh })
    .onConflictDoUpdate({
      target: [socialConnections.companyId, socialConnections.platform, socialConnections.externalAccountId],
      set: fresh,
      setWhere: sql`${socialConnections.id} = ${connection.id}`,
    })
    .returning({ id: socialConnections.id });
  return saved.length > 0;
}
