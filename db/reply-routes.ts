import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { ChatTarget } from "@/lib/chat-delivery";
import { CHAT_CHANNELS, type ConversationHandler } from "@/lib/conversations";
import { REPLY_WINDOW_HOURS } from "@/lib/telegram";
import { telegramReplyRouteWithin } from "./channel-connections";
import { messengerReplyRouteWithin } from "./messenger-routes";
import type { DbTransaction } from "./client";
import { contacts, conversations } from "./schema";

// Where a reply to one conversation's customer goes, read and locked inside
// the transaction that saves the reply: a person's (step 47) or one of the
// assistant's waiting replies sent by a person (step 49). Refused when it
// can't go: not a chat, or (Telegram, step 48; Messenger, step 53) the
// company's account or Page isn't connected, ansa may not reply, or the
// customer's last message is over 24 hours old (both platforms' rule).
// Nothing is saved then.

export type ReplyRefusal = "not-found" | "not-chat" | "not-connected" | "cannot-reply" | "window-closed";

export async function lockReplyRouteWithin(
  tx: DbTransaction,
  companyId: string,
  conversationId: string,
): Promise<{ handledBy: ConversationHandler; target: ChatTarget } | ReplyRefusal> {
  const [conversation] = await tx
    .select({
      handledBy: conversations.handledBy,
      channel: contacts.channel,
      externalId: contacts.externalId,
      replyWindowOpen: sql<boolean | null>`${conversations.lastCustomerMessageAt} > now() - make_interval(hours => ${REPLY_WINDOW_HOURS})`,
    })
    .from(conversations)
    .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.companyId, conversations.companyId)))
    .where(and(eq(conversations.id, conversationId), eq(conversations.companyId, companyId)))
    .for("update", { of: conversations });
  if (!conversation) {
    return "not-found";
  }
  if (!CHAT_CHANNELS.includes(conversation.channel)) {
    return "not-chat";
  }
  if (conversation.channel === "messenger") {
    const page = await messengerReplyRouteWithin(tx, companyId, conversation.externalId);
    if (!page) {
      return "not-connected";
    }
    if (!page.canMessage) {
      return "cannot-reply";
    }
    if (!conversation.replyWindowOpen) {
      return "window-closed";
    }
    const messenger = { connectionId: page.connectionId, pageId: page.pageId, isStandIn: page.isStandIn };
    return { handledBy: conversation.handledBy, target: { channel: conversation.channel, externalId: conversation.externalId, telegram: null, messenger } };
  }
  let telegram: ChatTarget["telegram"] = null;
  if (conversation.channel === "telegram") {
    const route = await telegramReplyRouteWithin(tx, companyId);
    if (!route || route.status === "removed_in_telegram") {
      return "not-connected";
    }
    if (route.status === "cannot_reply") {
      return "cannot-reply";
    }
    if (!conversation.replyWindowOpen) {
      return "window-closed";
    }
    telegram = { businessConnectionId: route.externalId, isStandIn: route.isStandIn };
  }
  return { handledBy: conversation.handledBy, target: { channel: conversation.channel, externalId: conversation.externalId, telegram } };
}
