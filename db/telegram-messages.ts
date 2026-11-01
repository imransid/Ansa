import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import type { ContactKey } from "@/lib/conversation-contacts";
import { db } from "./client";
import { conversationForContactWithin, touchConversationWithin } from "./conversation-links";
import { contacts, conversations, messages } from "./schema";

// Telegram's messages that aren't a customer's (step 48; a customer's go
// through insertCustomerChatMessage, db/conversation-writes.ts): what the
// restaurant wrote in its own Telegram app, and messages deleted in
// Telegram. Every write matches the company the connection belongs to.

// A message the restaurant wrote to a customer in its own Telegram app:
// part of the conversation, sent, with no teammate named. The same message
// arriving twice is saved once (false the second time).
export async function insertBusinessAccountMessage(
  companyId: string,
  contact: ContactKey,
  message: { messageId: string; bodyEncrypted: string; channelMessageId: string },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const conversationId = await conversationForContactWithin(tx, companyId, contact);
    const saved = await tx
      .insert(messages)
      .values({
        id: message.messageId,
        companyId,
        conversationId,
        direction: "out",
        author: "business_account",
        bodyEncrypted: message.bodyEncrypted,
        sendStatus: "sent",
        channelMessageId: message.channelMessageId,
      })
      .onConflictDoNothing({ target: [messages.conversationId, messages.channelMessageId] })
      .returning({ id: messages.id });
    if (saved.length > 0) {
      await touchConversationWithin(tx, companyId, conversationId, false);
      // You answered from your own app: the assistant no longer waits to step in (step 51).
      await tx
        .update(conversations)
        .set({ assistantDueAt: null })
        .where(and(eq(conversations.id, conversationId), eq(conversations.companyId, companyId)));
    }
    return saved.length > 0;
  });
}

// Deletes ansa's copies of messages deleted in Telegram (by the customer or
// the restaurant): the chat messages of that customer's conversation with
// those Telegram ids. Returns how many went.
export async function deleteTelegramMessages(companyId: string, chatId: string, channelMessageIds: string[]): Promise<number> {
  if (channelMessageIds.length === 0) {
    return 0;
  }
  const conversationOfChat = db
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.companyId, conversations.companyId)))
    .where(and(eq(conversations.companyId, companyId), eq(contacts.channel, "telegram"), eq(contacts.externalId, chatId)));
  const deleted = await db
    .delete(messages)
    .where(
      and(
        eq(messages.companyId, companyId),
        inArray(messages.conversationId, conversationOfChat),
        inArray(messages.channelMessageId, channelMessageIds),
        isNotNull(messages.bodyEncrypted),
      ),
    )
    .returning({ id: messages.id });
  return deleted.length;
}
