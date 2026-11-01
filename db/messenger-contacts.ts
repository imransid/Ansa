import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./client";
import { contacts, conversations } from "./schema";

// A Messenger customer's name (step 53), as Meta gives it to the Page,
// filled in once on their contact when it has none: Meta's message carries
// only an id. Matches the company in every WHERE.
export async function fillContactNameOnce(companyId: string, conversationId: string, name: string): Promise<void> {
  await db
    .update(contacts)
    .set({ displayName: name })
    .where(
      and(
        eq(contacts.companyId, companyId),
        isNull(contacts.displayName),
        eq(contacts.id, sql`(SELECT ${conversations.contactId} FROM ${conversations} WHERE ${conversations.id} = ${conversationId} AND ${conversations.companyId} = ${companyId})`),
      ),
    );
}

// Whether the contact of this conversation still has no name.
export async function contactNeedsName(companyId: string, conversationId: string): Promise<boolean> {
  const [row] = await db
    .select({ name: contacts.displayName })
    .from(conversations)
    .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.companyId, conversations.companyId)))
    .where(and(eq(conversations.id, conversationId), eq(conversations.companyId, companyId)));
  return row !== undefined && row.name === null;
}
