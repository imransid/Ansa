import "server-only";
import { and, count, desc, eq, exists, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { ActivityAction, ConversationChannel, ConversationHandler, MessageAuthor, SendError, SendStatus } from "@/lib/conversations";
import type { InboxView } from "@/lib/inbox";
import { PAGE_SIZE, pageOffset } from "@/lib/pagination";
import { REPLY_WINDOW_HOURS } from "@/lib/telegram";
import { db } from "./client";
import { assistantActivity, calls, contacts, conversations, inboundEmails, messages, tickets, users } from "./schema";

// Reading the Inbox (step 47): one company's conversations, one conversation
// and its entries, and the assistant's activity. Every query matches the
// company, and every join matches it again, so nothing of another company
// can come along.

export type { InboxView } from "@/lib/inbox";

export type ConversationListRow = {
  id: string;
  channel: ConversationChannel;
  displayName: string | null;
  externalId: string;
  handledBy: ConversationHandler;
  lastActivityAt: Date;
};

export type ConversationEntry = {
  id: string;
  author: MessageAuthor;
  authorName: string | null;
  bodyEncrypted: string | null;
  sendStatus: SendStatus | null;
  sendError: SendError | null;
  createdAt: Date;
  call: { id: string; startedAt: Date | null; aiOutcome: string | null } | null;
  email: { id: string; subjectEncrypted: string | null; ticketId: string | null } | null;
};

// "Needs you": a conversation with an open ticket in it, or (step 49) a
// reply of the assistant waiting for a person ("Ask me first"). Home's count
// (db/business-overview.ts) uses it too, so the two always agree.
export function needsYouCondition(): SQL {
  const openTicket = exists(
    db
      .select({ id: tickets.id })
      .from(tickets)
      .where(and(eq(tickets.companyId, conversations.companyId), eq(tickets.conversationId, conversations.id), eq(tickets.status, "open"))),
  );
  const waitingReply = exists(
    db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.companyId, conversations.companyId), eq(messages.conversationId, conversations.id), eq(messages.sendStatus, "draft"))),
  );
  return or(openTicket, waitingReply) ?? openTicket;
}

function viewCondition(companyId: string, view: InboxView): SQL | undefined {
  return view === "needs-you" ? and(eq(conversations.companyId, companyId), needsYouCondition()) : eq(conversations.companyId, companyId);
}

// One page of the company's conversations in a view, the latest activity first.
export async function listConversations(companyId: string, view: InboxView, page: number): Promise<ConversationListRow[]> {
  return db
    .select({
      id: conversations.id,
      channel: contacts.channel,
      displayName: contacts.displayName,
      externalId: contacts.externalId,
      handledBy: conversations.handledBy,
      lastActivityAt: conversations.lastActivityAt,
    })
    .from(conversations)
    .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.companyId, conversations.companyId)))
    .where(viewCondition(companyId, view))
    .orderBy(desc(conversations.lastActivityAt), desc(conversations.id))
    .limit(PAGE_SIZE)
    .offset(pageOffset(page));
}

// How many conversations each view holds.
export async function countConversations(companyId: string): Promise<Record<InboxView, number>> {
  const [needsYou] = await db.select({ total: count() }).from(conversations).where(viewCondition(companyId, "needs-you"));
  const [all] = await db.select({ total: count() }).from(conversations).where(viewCondition(companyId, "all"));
  return { "needs-you": needsYou?.total ?? 0, all: all?.total ?? 0 };
}

// The newest entry of each of these conversations (for the list's preview).
export async function latestEntries(companyId: string, conversationIds: string[]) {
  if (conversationIds.length === 0) {
    return [];
  }
  return db
    .selectDistinctOn([messages.conversationId], {
      conversationId: messages.conversationId,
      id: messages.id,
      author: messages.author,
      bodyEncrypted: messages.bodyEncrypted,
      callId: messages.callId,
      inboundEmailId: messages.inboundEmailId,
    })
    .from(messages)
    .where(and(eq(messages.companyId, companyId), inArray(messages.conversationId, conversationIds)))
    .orderBy(messages.conversationId, desc(messages.createdAt));
}

// The open tickets of these conversations, newest first.
export async function openTicketsOf(companyId: string, conversationIds: string[]) {
  if (conversationIds.length === 0) {
    return [];
  }
  return db
    .select({ conversationId: tickets.conversationId, id: tickets.id, ticketNumber: tickets.ticketNumber, subject: tickets.subject })
    .from(tickets)
    .where(and(eq(tickets.companyId, companyId), inArray(tickets.conversationId, conversationIds), eq(tickets.status, "open")))
    .orderBy(desc(tickets.createdAt));
}

const taker = alias(users, "taker");

// One conversation of the company with its contact, or null (another
// company's, or none).
export async function getConversation(companyId: string, conversationId: string) {
  const [row] = await db
    .select({
      id: conversations.id,
      channel: contacts.channel,
      displayName: contacts.displayName,
      externalId: contacts.externalId,
      handledBy: conversations.handledBy,
      takenOverAt: conversations.takenOverAt,
      takenOverByName: taker.name,
      // Step 51: someone the owner marked important always comes to them.
      important: contacts.important,
      // Telegram lets ansa reply only within 24 hours of the customer's last message.
      replyWindowOpen: sql<boolean>`coalesce(${conversations.lastCustomerMessageAt} > now() - make_interval(hours => ${REPLY_WINDOW_HOURS}), false)`,
    })
    .from(conversations)
    .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.companyId, conversations.companyId)))
    .leftJoin(taker, and(eq(taker.id, conversations.takenOverByUserId), eq(taker.companyId, conversations.companyId)))
    .where(and(eq(conversations.id, conversationId), eq(conversations.companyId, companyId)));
  return row ?? null;
}

const author = alias(users, "author");

// The newest 200 entries of one conversation, oldest first: chat messages,
// and the calls and emails linked to it (their content stays on them).
export async function listConversationEntries(companyId: string, conversationId: string): Promise<ConversationEntry[]> {
  const rows = await db
    .select({
      id: messages.id,
      author: messages.author,
      authorName: author.name,
      bodyEncrypted: messages.bodyEncrypted,
      sendStatus: messages.sendStatus,
      sendError: messages.sendError,
      createdAt: messages.createdAt,
      callId: calls.id,
      callStartedAt: calls.startedAt,
      callOutcome: calls.aiOutcome,
      emailId: inboundEmails.id,
      emailSubjectEncrypted: inboundEmails.subjectEncrypted,
      emailTicketId: inboundEmails.ticketId,
    })
    .from(messages)
    .leftJoin(author, and(eq(author.id, messages.authorUserId), eq(author.companyId, messages.companyId)))
    .leftJoin(calls, and(eq(calls.id, messages.callId), eq(calls.companyId, messages.companyId)))
    .leftJoin(inboundEmails, and(eq(inboundEmails.id, messages.inboundEmailId), eq(inboundEmails.companyId, messages.companyId)))
    .where(and(eq(messages.companyId, companyId), eq(messages.conversationId, conversationId)))
    .orderBy(desc(messages.createdAt))
    .limit(200);
  return rows.reverse().map((row) => ({
    id: row.id,
    author: row.author,
    authorName: row.authorName,
    bodyEncrypted: row.bodyEncrypted,
    sendStatus: row.sendStatus,
    sendError: row.sendError,
    createdAt: row.createdAt,
    call: row.callId ? { id: row.callId, startedAt: row.callStartedAt, aiOutcome: row.callOutcome } : null,
    email: row.emailId ? { id: row.emailId, subjectEncrypted: row.emailSubjectEncrypted, ticketId: row.emailTicketId } : null,
  }));
}

const actor = alias(users, "actor");

// The newest activity of the company: the assistant's (Home's "What ansa
// did", `assistantOnly`) or everything of one conversation.
export async function listActivity(companyId: string, filter: { assistantOnly: true } | { conversationId: string }, limit: number) {
  const scope = "conversationId" in filter ? eq(assistantActivity.conversationId, filter.conversationId) : isNull(assistantActivity.actorUserId);
  return db
    .select({
      id: assistantActivity.id,
      conversationId: assistantActivity.conversationId,
      action: sql<ActivityAction>`${assistantActivity.action}`,
      reason: assistantActivity.reason,
      createdAt: assistantActivity.createdAt,
      actorName: actor.name,
      contactName: contacts.displayName,
      channel: contacts.channel,
    })
    .from(assistantActivity)
    .innerJoin(conversations, and(eq(conversations.id, assistantActivity.conversationId), eq(conversations.companyId, assistantActivity.companyId)))
    .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.companyId, conversations.companyId)))
    .leftJoin(actor, and(eq(actor.id, assistantActivity.actorUserId), eq(actor.companyId, assistantActivity.companyId)))
    .where(and(eq(assistantActivity.companyId, companyId), scope))
    .orderBy(desc(assistantActivity.createdAt))
    .limit(limit);
}
