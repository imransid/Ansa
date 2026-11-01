import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { socialConnections } from "./schema";

// Which company a Messenger message is for (step 53), from the Page id in
// a message Meta signed: ansa's own Facebook Page connections (step 40),
// read across companies (one of the documented exceptions in CLAUDE.md).
// Yes or no and the connection's id, nothing else of its row. A Page
// connected in two companies at once decides nothing: the message is
// ignored (as an email naming two forwarding addresses is).
export async function findMessengerPage(pageId: string): Promise<{ companyId: string; connectionId: string } | null> {
  const rows = await db
    .select({ companyId: socialConnections.companyId, connectionId: socialConnections.id })
    .from(socialConnections)
    .where(and(eq(socialConnections.platform, "facebook"), eq(socialConnections.externalAccountId, pageId), eq(socialConnections.status, "connected")))
    .limit(2);
  return rows.length === 1 ? rows[0] : null;
}

// The company's development stand-in Facebook Page (step 40's "Connect a
// stand-in account"), for pnpm simulate:messenger: its own company only.
export async function findStandInFacebookPage(companyId: string): Promise<{ connectionId: string; pageId: string } | null> {
  const [row] = await db
    .select({ connectionId: socialConnections.id, pageId: socialConnections.externalAccountId })
    .from(socialConnections)
    .where(
      and(
        eq(socialConnections.companyId, companyId),
        eq(socialConnections.platform, "facebook"),
        eq(socialConnections.isStandIn, true),
        eq(socialConnections.status, "connected"),
      ),
    );
  return row ?? null;
}
