import "server-only";
import { and, eq } from "drizzle-orm";
import { messengerPageId } from "@/lib/messenger";
import { db, type DbTransaction } from "./client";
import { socialConnections } from "./schema";

// The company's Facebook Page a Messenger customer wrote to (step 53), read
// inside the transaction that saves a reply: connected, and allowed to send
// messages (pages_messaging granted, or a development stand-in). Null when
// the Page isn't connected in this company any more.
export async function messengerReplyRouteWithin(
  tx: DbTransaction,
  companyId: string,
  contactExternalId: string,
): Promise<{ connectionId: string; pageId: string; isStandIn: boolean; canMessage: boolean } | null> {
  const pageId = messengerPageId(contactExternalId);
  if (!pageId) {
    return null;
  }
  const [page] = await tx
    .select({ id: socialConnections.id, isStandIn: socialConnections.isStandIn, scopes: socialConnections.scopes })
    .from(socialConnections)
    .where(
      and(
        eq(socialConnections.companyId, companyId),
        eq(socialConnections.platform, "facebook"),
        eq(socialConnections.externalAccountId, pageId),
        eq(socialConnections.status, "connected"),
      ),
    )
    .for("share");
  if (!page) {
    return null;
  }
  return { connectionId: page.id, pageId, isStandIn: page.isStandIn, canMessage: page.isStandIn || page.scopes.includes("pages_messaging") };
}

// The same, read outside a transaction: what the conversation's page says
// before anyone types.
export async function readMessengerReplyRoute(companyId: string, contactExternalId: string) {
  return db.transaction((tx) => messengerReplyRouteWithin(tx, companyId, contactExternalId));
}
