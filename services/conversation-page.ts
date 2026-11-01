import "server-only";
import type { OrderStatus } from "@/lib/orders";
import { getLiveTelegramConnection } from "@/db/channel-connections";
import { getConversation, listActivity, listConversationEntries, openTicketsOf } from "@/db/conversations";
import { readMessengerReplyRoute } from "@/db/messenger-routes";
import { ordersOfConversation } from "@/db/orders";
import { CHAT_CHANNELS, type MessageAuthor, type SendError, type SendStatus } from "@/lib/conversations";
import { decryptForDisplay } from "@/lib/encryption";
import { conversationMessageContext, inboundEmailSubjectContext } from "@/lib/encryption-contexts";
import type { SessionContext } from "@/lib/session";
import { conversationIdSchema } from "@/lib/validation/conversations";
import { getTicketForSession, type TicketDetail } from "./tickets";

// One Inbox conversation's page (step 47): its entries in order (chat
// messages decrypted for the company's own team, calls and emails as links
// to their own pages), its open request with that ticket's actions, and its
// history. Everyone in the company reads it.

export type ConversationEntryView = {
  id: string;
  author: MessageAuthor;
  authorName: string | null;
  createdAt: Date;
  sendStatus: SendStatus | null;
  sendError: SendError | null;
  // A chat message's text (null when it couldn't be decrypted: unreadable).
  text: string | null;
  unreadable: boolean;
  call: { id: string; startedAt: Date | null; aiOutcome: string | null } | null;
  email: { subject: string | null; ticketId: string | null } | null;
};

export type ConversationPage = NonNullable<Awaited<ReturnType<typeof getConversation>>> & {
  entries: ConversationEntryView[];
  // The newest open request, with what its actions need; others listed.
  openTicket: TicketDetail | null;
  otherOpenTickets: { ticketNumber: number; subject: string }[];
  activity: Awaited<ReturnType<typeof listActivity>>;
  // Only chat channels can be answered from ansa.
  canReply: boolean;
  // Why a Telegram reply can't go now (step 48), or null.
  replyBlocked: "not-connected" | "cannot-reply" | "window-closed" | null;
  // This customer's newest placed orders (step 52).
  orders: { orderNumber: number | null; status: OrderStatus; totalCents: number; currency: string }[];
};

// The page of one conversation of the session's company, or null when the id
// isn't one (another company's, or none): the page's not-found then.
export async function getConversationPageForSession(session: SessionContext, conversationId: unknown): Promise<ConversationPage | null> {
  const parsed = conversationIdSchema.safeParse(conversationId);
  if (!parsed.success) {
    return null;
  }
  const conversation = await getConversation(session.companyId, parsed.data);
  if (!conversation) {
    return null;
  }
  const [entries, openTickets, activity, orders] = await Promise.all([
    listConversationEntries(session.companyId, conversation.id),
    openTicketsOf(session.companyId, [conversation.id]),
    listActivity(session.companyId, { conversationId: conversation.id }, 20),
    ordersOfConversation(session.companyId, conversation.id),
  ]);
  const [newest, ...others] = openTickets;
  return {
    ...conversation,
    entries: entries.map((entry) => ({
      id: entry.id,
      author: entry.author,
      authorName: entry.authorName,
      createdAt: entry.createdAt,
      sendStatus: entry.sendStatus,
      sendError: entry.sendError,
      ...textOf(session.companyId, entry.id, entry.bodyEncrypted),
      call: entry.call,
      email: entry.email ? { subject: subjectOf(session.companyId, entry.email.id, entry.email.subjectEncrypted), ticketId: entry.email.ticketId } : null,
    })),
    openTicket: newest ? await getTicketForSession(session, String(newest.ticketNumber)) : null,
    otherOpenTickets: others.map((ticket) => ({ ticketNumber: ticket.ticketNumber, subject: ticket.subject })),
    activity,
    canReply: CHAT_CHANNELS.includes(conversation.channel),
    replyBlocked:
      conversation.channel === "telegram"
        ? await telegramReplyBlock(session.companyId, conversation.replyWindowOpen)
        : conversation.channel === "messenger"
          ? await messengerReplyBlock(session.companyId, conversation.externalId, conversation.replyWindowOpen)
          : null,
    orders: orders.placed.map((order) => ({ orderNumber: order.orderNumber, status: order.status, totalCents: order.totalCents, currency: order.currency })),
  };
}

// The same rules the reply itself checks (db/conversation-writes.ts), read
// for the page so the box says it before anyone types.
async function telegramReplyBlock(companyId: string, replyWindowOpen: boolean): Promise<ConversationPage["replyBlocked"]> {
  const connection = await getLiveTelegramConnection(companyId);
  if (!connection || connection.status === "removed_in_telegram") {
    return "not-connected";
  }
  if (connection.status === "cannot_reply") {
    return "cannot-reply";
  }
  return replyWindowOpen ? null : "window-closed";
}

// The same for Messenger (step 53): the Page connected here, allowed to
// send messages, and Meta's 24 hours.
async function messengerReplyBlock(companyId: string, externalId: string, replyWindowOpen: boolean): Promise<ConversationPage["replyBlocked"]> {
  const page = await readMessengerReplyRoute(companyId, externalId);
  if (!page) {
    return "not-connected";
  }
  if (!page.canMessage) {
    return "cannot-reply";
  }
  return replyWindowOpen ? null : "window-closed";
}

function textOf(companyId: string, messageId: string, bodyEncrypted: string | null): { text: string | null; unreadable: boolean } {
  if (bodyEncrypted === null) {
    return { text: null, unreadable: false };
  }
  return decryptForDisplay(bodyEncrypted, conversationMessageContext(companyId, messageId));
}

function subjectOf(companyId: string, inboundEmailId: string, subjectEncrypted: string | null): string | null {
  return decryptForDisplay(subjectEncrypted, inboundEmailSubjectContext(companyId, inboundEmailId)).text;
}
