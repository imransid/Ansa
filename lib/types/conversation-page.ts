import type { MessageAuthor, SendError, SendStatus } from "@/lib/conversations";
import type { OrderStatus } from "@/lib/orders";
import type { ActivityRow, ConversationRow } from "@/lib/types/conversations";
import type { TicketDetail } from "@/lib/types/tickets";

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
  // The request it became, by number: the request's page holds the email.
  email: { subject: string | null; ticketId: string | null; ticketNumber: number | null } | null;
};

export type ConversationPage = ConversationRow & {
  // "If I haven't answered within N minutes" (step 51): when ansa answers
  // unless a person replies first; null while it isn't waiting.
  assistantDueAt: Date | null;
  // Development only, owners: "Answer now" instead of waiting (core decides).
  canAnswerNow: boolean;
  entries: ConversationEntryView[];
  // The newest open request, with what its actions need; others listed.
  openTicket: TicketDetail | null;
  otherOpenTickets: { ticketNumber: number; subject: string }[];
  activity: ActivityRow[];
  // Only chat channels can be answered from ansa.
  canReply: boolean;
  // Why a Telegram reply can't go now (step 48), or null.
  replyBlocked: "not-connected" | "cannot-reply" | "window-closed" | null;
  // This customer's newest placed orders (step 52).
  orders: { orderNumber: number | null; status: OrderStatus; totalCents: number; currency: string }[];
};
