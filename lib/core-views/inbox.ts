import "server-only";
import { callCore } from "@/lib/core-api";
import { asFormResult } from "@/lib/core-views/ticket-actions";
import { getRequestPageFromCore, type TicketView } from "@/lib/core-views/tickets";
import type { FormResult } from "@/lib/form-result";
import type { InboxView } from "@/lib/inbox";
import type { CompanyKind } from "@/lib/restaurant-setup";
import type { ConversationEntryView, ConversationPage } from "@/lib/types/conversation-page";
import type { InboxRow } from "@/lib/types/conversations";

// The Inbox and one conversation's page through the new backend (core's
// /api/v1/inbox and /api/v1/conversations), in the shapes the pages and
// their actions already read.

// What a conversation's page reads. Core gives it, and works out whether a
// reply may go itself (replyBlocked), so the page never needs the reply
// window, and the open request is the request's own view.
export type ConversationView = Omit<ConversationPage, "replyWindowOpen" | "openTicket"> & { openTicket: TicketView | null };

type CoreRequestLine = { id: string; number: number; subject: string };

type CoreRow = Omit<InboxRow, "lastActivityAt" | "openTicket"> & { lastActivityAt: string; openTicket: CoreRequestLine | null };

type CoreEntry = Omit<ConversationEntryView, "createdAt" | "call"> & {
  createdAt: string;
  call: { id: string; startedAt: string | null; aiOutcome: string | null } | null;
};

type CoreActivity = Omit<ConversationPage["activity"][number], "createdAt"> & { createdAt: string };

type CoreConversation = Pick<ConversationPage, "id" | "channel" | "displayName" | "externalId" | "handledBy" | "takenOverByName" | "important" | "canReply" | "canAnswerNow"> & {
  takenOverAt: string | null;
  assistantDueAt: string | null;
  entries: CoreEntry[];
  // Newest first: the first one is the request the page works on.
  openTickets: CoreRequestLine[];
  activity: CoreActivity[];
  // "" when a reply may go now.
  replyBlocked: NonNullable<ConversationPage["replyBlocked"]> | "";
  orders: { number: number; status: ConversationPage["orders"][number]["status"]; fulfilment: ConversationPage["orders"][number]["fulfilment"]; totalCents: number; currency: string }[];
};

// One page of a view of the Inbox, and how many each view holds.
export async function getInboxFromCore(view: InboxView, page: number): Promise<{ rows: InboxRow[]; counts: Record<InboxView, number> }> {
  const search = new URLSearchParams({ view, page: String(page) });
  const answer = await callCore<{ rows: CoreRow[]; counts: Record<InboxView, number> }>("GET", `/api/v1/inbox?${search}`);
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  return { rows: answer.data.rows.map(toInboxRow), counts: answer.data.counts };
}

// Whether the account is a business or one person (setup's first step).
// Core's settings answer doesn't hold it, its setup answer does. A failed
// read shows a business's page: only "New request" and the assignee menu
// depend on it, and core refuses what the person may not do either way.
export async function getAccountKindFromCore(): Promise<CompanyKind> {
  const answer = await callCore<{ profile: { kind: CompanyKind } }>("GET", "/api/v1/setup");
  return answer.ok ? answer.data.profile.kind : "business";
}

// One conversation of the session's company, or null when the id isn't one
// (the page's not-found). Its newest open request comes with that request's
// own page read (getRequestPageFromCore), which the page reads again for the
// assignee menu without a second call.
export async function getConversationFromCore(conversationId: string): Promise<ConversationView | null> {
  const answer = await callCore<CoreConversation>("GET", `/api/v1/conversations/${encodeURIComponent(conversationId)}`);
  if (!answer.ok && answer.status === 404) {
    return null;
  }
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  const conversation = answer.data;
  const [newest, ...others] = conversation.openTickets;
  const request = newest ? await getRequestPageFromCore(String(newest.number)) : null;
  return {
    id: conversation.id,
    channel: conversation.channel,
    displayName: conversation.displayName,
    externalId: conversation.externalId,
    handledBy: conversation.handledBy,
    takenOverAt: conversation.takenOverAt ? new Date(conversation.takenOverAt) : null,
    takenOverByName: conversation.takenOverByName,
    important: conversation.important,
    assistantDueAt: conversation.assistantDueAt ? new Date(conversation.assistantDueAt) : null,
    canAnswerNow: conversation.canAnswerNow,
    entries: conversation.entries.map(toEntryView),
    openTicket: request?.ticket ?? null,
    otherOpenTickets: others.map((ticket) => ({ ticketNumber: ticket.number, subject: ticket.subject })),
    activity: conversation.activity.map((row) => ({ ...row, createdAt: new Date(row.createdAt) })),
    canReply: conversation.canReply,
    replyBlocked: conversation.replyBlocked === "" ? null : conversation.replyBlocked,
    orders: conversation.orders.map((order) => ({
      orderNumber: order.number,
      status: order.status,
      fulfilment: order.fulfilment,
      totalCents: order.totalCents,
      currency: order.currency,
    })),
  };
}

export async function takeOverThroughCore(conversationId: string): Promise<FormResult> {
  return asFormResult(await callCore("POST", conversationPath(conversationId, "take-over")));
}

export async function handBackThroughCore(conversationId: string): Promise<FormResult> {
  return asFormResult(await callCore("POST", conversationPath(conversationId, "hand-back")));
}

// "Done" on a chat's request: closed without an email, then back to ansa.
export async function finishChatRequestThroughCore(conversationId: string, ticketId: string): Promise<FormResult> {
  return asFormResult(await callCore("POST", conversationPath(conversationId, "done"), { ticketId }));
}

// A person's reply ("" = a new one; else it replaces the assistant's waiting reply).
export async function replyThroughCore(conversationId: string, text: string, replacesDraftId: string): Promise<FormResult> {
  const answer = await callCore("POST", conversationPath(conversationId, "reply"), { text, replacesDraftId });
  if (answer.ok) {
    return { ok: true };
  }
  // Core answers 400 only for what is wrong with the typed text: it goes under the box.
  return { ok: false, errors: answer.status === 400 ? { fieldErrors: { text: [answer.message] } } : { message: answer.message } };
}

// The assistant's waiting reply ("Ask me first"): sent as written, or discarded.
export async function sendDraftThroughCore(conversationId: string, messageId: string): Promise<FormResult> {
  return asFormResult(await callCore("POST", `${conversationPath(conversationId, "drafts")}/${encodeURIComponent(messageId)}/send`));
}

export async function discardDraftThroughCore(conversationId: string, messageId: string): Promise<FormResult> {
  return asFormResult(await callCore("POST", `${conversationPath(conversationId, "drafts")}/${encodeURIComponent(messageId)}/discard`));
}

// "Answer now" (development only, owners): ansa answers at the scheduler's
// next round instead of waiting out the minutes. Core refuses it elsewhere.
export async function answerNowThroughCore(conversationId: string): Promise<FormResult> {
  return asFormResult(await callCore("POST", conversationPath(conversationId, "answer-now")));
}

// The id is only a claim from a form: core checks it belongs to the session's company.
function conversationPath(conversationId: string, action: string): string {
  return `/api/v1/conversations/${encodeURIComponent(conversationId)}/${action}`;
}

function toInboxRow(row: CoreRow): InboxRow {
  return {
    id: row.id,
    channel: row.channel,
    displayName: row.displayName,
    externalId: row.externalId,
    handledBy: row.handledBy,
    lastActivityAt: new Date(row.lastActivityAt),
    preview: row.preview,
    openTicket: row.openTicket ? { ticketNumber: row.openTicket.number, subject: row.openTicket.subject } : null,
    draftWaiting: row.draftWaiting,
  };
}

function toEntryView(entry: CoreEntry): ConversationEntryView {
  return {
    id: entry.id,
    author: entry.author,
    authorName: entry.authorName,
    createdAt: new Date(entry.createdAt),
    sendStatus: entry.sendStatus,
    sendError: entry.sendError,
    text: entry.text,
    unreadable: entry.unreadable,
    call: entry.call ? { id: entry.call.id, startedAt: entry.call.startedAt ? new Date(entry.call.startedAt) : null, aiOutcome: entry.call.aiOutcome } : null,
    email: entry.email ? { subject: entry.email.subject, ticketId: entry.email.ticketId, ticketNumber: entry.email.ticketNumber } : null,
  };
}
