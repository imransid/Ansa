import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { lockActiveAuthorRole } from "./knowledge-author";
import { contacts, conversations } from "./schema";

// Marks the person behind one conversation important, or not (step 51):
// the assistant never answers them itself, it hands them to you. Anyone in
// the company, as they work conversations; the person read again, the
// conversation matched with the company.
export async function setContactImportant(
  companyId: string,
  actorUserId: string,
  conversationId: string,
  important: boolean,
): Promise<"saved" | "not-allowed" | "not-found"> {
  return db.transaction(async (tx) => {
    if (!(await lockActiveAuthorRole(tx, companyId, actorUserId))) {
      return "not-allowed";
    }
    const [conversation] = await tx
      .select({ contactId: conversations.contactId })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.companyId, companyId)));
    if (!conversation) {
      return "not-found";
    }
    await tx
      .update(contacts)
      .set({ important })
      .where(and(eq(contacts.id, conversation.contactId), eq(contacts.companyId, companyId)));
    return "saved";
  });
}
