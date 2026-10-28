import "server-only";
import { randomUUID } from "node:crypto";
import { findConnectionIds, saveSocialConnections, type ConnectionToSave } from "@/db/social-connections";
import { encryptText } from "@/lib/encryption";
import { socialTokenContext } from "@/lib/encryption-contexts";
import type { SocialPlatform } from "@/lib/social-platforms";
import type { AuthorizedAccount } from "@/lib/social-types";

export type SaveAccountsOutcome = "saved" | "not-allowed" | "changed";

// Saves the accounts a platform (or the stand-in) authorized for a company,
// each token encrypted with its own connection's context (company,
// connection id, token kind). An account connected before keeps its row
// and id, and gets the new tokens. actorUserId must still be an active
// owner (checked again in /db).
export async function saveAuthorizedAccounts(
  companyId: string,
  actorUserId: string,
  platform: SocialPlatform,
  accounts: AuthorizedAccount[],
  isStandIn: boolean,
): Promise<SaveAccountsOutcome> {
  // WHY a second try: a connection of the same account made at the same
  // moment can take a new row under another id; the tokens are encrypted
  // again for the id that is there now (db/social-connections.ts).
  let outcome: SaveAccountsOutcome = "changed";
  for (let attempt = 0; attempt < 2 && outcome === "changed"; attempt++) {
    const ids = await findConnectionIds(companyId, platform, accounts.map((account) => account.externalAccountId));
    const rows = accounts.map((account) => toSave(companyId, ids.get(account.externalAccountId) ?? randomUUID(), account));
    outcome = await saveSocialConnections(companyId, actorUserId, platform, isStandIn, rows);
  }
  return outcome;
}

// One account as /db saves it, its tokens encrypted for this connection id.
function toSave(companyId: string, connectionId: string, account: AuthorizedAccount): ConnectionToSave {
  const refreshToken = account.refreshToken;
  return {
    id: connectionId,
    externalAccountId: account.externalAccountId,
    displayName: account.displayName,
    accountKind: account.accountKind,
    scopes: account.scopes,
    accessTokenEncrypted: encryptText(account.accessToken, socialTokenContext(companyId, connectionId, "access")),
    refreshTokenEncrypted: refreshToken ? encryptText(refreshToken, socialTokenContext(companyId, connectionId, "refresh")) : null,
    accessExpiresAt: account.accessExpiresAt,
    // An expiry only for a refresh token that is kept.
    refreshExpiresAt: refreshToken ? account.refreshExpiresAt : null,
  };
}
