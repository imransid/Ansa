import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { ChatTarget } from "@/lib/chat-delivery";
import { REPLY_WINDOW_HOURS } from "@/lib/telegram";
import { telegramReplyRouteWithin } from "./channel-connections";
import type { DbTransaction } from "./client";
import { messengerReplyRouteWithin } from "./messenger-routes";
import { contacts, conversations } from "./schema";

// Where a message to this conversation's customer goes (the company's
// Telegram connection, when it may send), as a person's reply finds it.
export async function chatTargetWithin(tx: DbTransaction, turn: { companyId: string; conversationId: string }): Promise<ChatTarget> {
  const [contact] = await tx
    .select({
      channel: contacts.channel,
      externalId: contacts.externalId,
      replyWindowOpen: sql<boolean>`coalesce(${conversations.lastCustomerMessageAt} > now() - make_interval(hours => ${REPLY_WINDOW_HOURS}), false)`,
    })
    .from(conversations)
    .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.companyId, conversations.companyId)))
    .where(and(eq(conversations.id, turn.conversationId), eq(conversations.companyId, turn.companyId)));
  if (contact.channel === "messenger") {
    const page = await messengerReplyRouteWithin(tx, turn.companyId, contact.externalId);
    const maySend = page !== null && page.canMessage && contact.replyWindowOpen;
    return {
      channel: contact.channel,
      externalId: contact.externalId,
      telegram: null,
      messenger: page && maySend ? { connectionId: page.connectionId, pageId: page.pageId, isStandIn: page.isStandIn } : null,
    };
  }
  if (contact.channel !== "telegram") {
    return { channel: contact.channel, externalId: contact.externalId, telegram: null };
  }
  const route = await telegramReplyRouteWithin(tx, turn.companyId);
  const maySend = route?.status === "connected" && contact.replyWindowOpen;
  return {
    channel: contact.channel,
    externalId: contact.externalId,
    telegram: route && maySend ? { businessConnectionId: route.externalId, isStandIn: route.isStandIn } : null,
  };
}
