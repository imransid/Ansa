import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { ChatDeliveryResult, ChatTarget } from "@/lib/chat-delivery";
import type { ContactKey } from "@/lib/conversation-contacts";
import { db, type DbTransaction } from "./client";
import { conversationForContactWithin, recordActivityWithin, touchConversationWithin } from "./conversation-links";
import { lockActiveAuthorRole } from "./knowledge-author";
import { lockReplyRouteWithin, type ReplyRefusal } from "./reply-routes";
import { conversations, messages } from "./schema";

// Changing the Inbox (step 47): taking a conversation over and handing it
// back, a person's reply, and a customer's chat message arriving. Everyone in
// the company works conversations (as they work tickets): each write checks
// the person is still an active member, inside its transaction, and matches
// every id with the session's company. Message texts arrive encrypted.

export type ConversationWriteOutcome = "saved" | "unchanged" | "not-allowed" | "not-found";

// A person takes the conversation over from the assistant.
export async function takeOverConversation(companyId: string, actorUserId: string, conversationId: string): Promise<ConversationWriteOutcome> {
  return db.transaction(async (tx) => {
    if (!(await lockActiveAuthorRole(tx, companyId, actorUserId))) {
      return "not-allowed";
    }
    const changed = await tx
      .update(conversations)
      .set({ handledBy: "person", takenOverByUserId: actorUserId, takenOverAt: sql`now()` })
      .where(and(eq(conversations.id, conversationId), eq(conversations.companyId, companyId), eq(conversations.handledBy, "assistant")))
      .returning({ id: conversations.id });
    if (changed.length === 0) {
      return (await exists(companyId, conversationId)) ? "unchanged" : "not-found";
    }
    await recordActivityWithin(tx, companyId, conversationId, "taken_over", actorUserId);
    return "saved";
  });
}

// A person hands the conversation back to the assistant.
export async function handBackConversation(companyId: string, actorUserId: string, conversationId: string): Promise<ConversationWriteOutcome> {
  return db.transaction(async (tx) => {
    if (!(await lockActiveAuthorRole(tx, companyId, actorUserId))) {
      return "not-allowed";
    }
    const changed = await tx
      .update(conversations)
      .set({ handledBy: "assistant", takenOverByUserId: null, takenOverAt: null })
      .where(and(eq(conversations.id, conversationId), eq(conversations.companyId, companyId), eq(conversations.handledBy, "person")))
      .returning({ id: conversations.id });
    if (changed.length === 0) {
      return (await exists(companyId, conversationId)) ? "unchanged" : "not-found";
    }
    await recordActivityWithin(tx, companyId, conversationId, "handed_back", actorUserId);
    return "saved";
  });
}

// A person's reply on a chat conversation, saved "sending" before it goes
// out. Replying takes the conversation over when the assistant had it.
// `messageId` is the id its text was encrypted for; `replacesDraftId`: the
// assistant's waiting reply this one replaces (the person edited it, step
// 49), discarded in the same transaction. Returns where to send it, or why
// it can't go (db/reply-routes.ts): nothing is saved then.
export async function insertPersonReply(
  companyId: string,
  actorUserId: string,
  reply: { conversationId: string; messageId: string; bodyEncrypted: string; replacesDraftId?: string | null },
): Promise<ChatTarget | "not-allowed" | ReplyRefusal> {
  return db.transaction(async (tx) => {
    if (!(await lockActiveAuthorRole(tx, companyId, actorUserId))) {
      return "not-allowed";
    }
    const route = await lockReplyRouteWithin(tx, companyId, reply.conversationId);
    if (typeof route === "string") {
      return route;
    }
    const conversation = { handledBy: route.handledBy };
    if (reply.replacesDraftId) {
      await discardDraftWithin(tx, companyId, reply.conversationId, reply.replacesDraftId);
    }
    // You answered yourself: the assistant no longer waits to step in (step 51).
    await tx
      .update(conversations)
      .set({ assistantDueAt: null })
      .where(and(eq(conversations.id, reply.conversationId), eq(conversations.companyId, companyId)));
    if (conversation.handledBy === "assistant") {
      await tx
        .update(conversations)
        .set({ handledBy: "person", takenOverByUserId: actorUserId, takenOverAt: sql`now()` })
        .where(and(eq(conversations.id, reply.conversationId), eq(conversations.companyId, companyId)));
      await recordActivityWithin(tx, companyId, reply.conversationId, "taken_over", actorUserId);
    }
    await tx.insert(messages).values({
      id: reply.messageId,
      companyId,
      conversationId: reply.conversationId,
      direction: "out",
      author: "person",
      authorUserId: actorUserId,
      bodyEncrypted: reply.bodyEncrypted,
      sendStatus: "sending",
    });
    await touchConversationWithin(tx, companyId, reply.conversationId, false);
    return route.target;
  });
}

// The assistant's waiting reply in this conversation goes unsent: it is
// "discarded" (kept, never shown to the customer). False when it isn't one.
export async function discardDraftWithin(tx: DbTransaction, companyId: string, conversationId: string, messageId: string): Promise<boolean> {
  const discarded = await tx
    .update(messages)
    .set({ sendStatus: "discarded" })
    .where(
      and(
        eq(messages.id, messageId),
        eq(messages.companyId, companyId),
        eq(messages.conversationId, conversationId),
        eq(messages.author, "assistant"),
        eq(messages.sendStatus, "draft"),
      ),
    )
    .returning({ id: messages.id });
  return discarded.length > 0;
}

// Records how sending a reply went (with the channel's id for it, or why it
// failed); only over "sending", so a late answer never undoes another.
export async function recordReplyDelivery(companyId: string, messageId: string, result: ChatDeliveryResult): Promise<void> {
  await db
    .update(messages)
    .set({
      sendStatus: result.status,
      sendError: result.status === "sent" ? null : result.error,
      channelMessageId: result.status === "sent" ? result.channelMessageId : null,
    })
    .where(and(eq(messages.id, messageId), eq(messages.companyId, companyId), eq(messages.sendStatus, "sending")));
}

// A customer's chat message arriving: their conversation (made on first
// contact), the message, the conversation moved to the top. The same channel
// message arriving twice is saved once (null the second time). Returns
// where it was saved, for the assistant to answer (step 49).
export async function insertCustomerChatMessage(
  companyId: string,
  contact: ContactKey,
  message: { messageId: string; bodyEncrypted: string; channelMessageId: string },
): Promise<{ companyId: string; conversationId: string; triggerMessageId: string } | null> {
  return db.transaction(async (tx) => {
    const conversationId = await conversationForContactWithin(tx, companyId, contact);
    const saved = await tx
      .insert(messages)
      .values({
        id: message.messageId,
        companyId,
        conversationId,
        direction: "in",
        author: "customer",
        bodyEncrypted: message.bodyEncrypted,
        channelMessageId: message.channelMessageId,
      })
      .onConflictDoNothing({ target: [messages.conversationId, messages.channelMessageId] })
      .returning({ id: messages.id });
    if (saved.length === 0) {
      return null;
    }
    await touchConversationWithin(tx, companyId, conversationId, true);
    return { companyId, conversationId, triggerMessageId: message.messageId };
  });
}

async function exists(companyId: string, conversationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.companyId, companyId)));
  return row !== undefined;
}
