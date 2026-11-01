import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { ContactKey } from "@/lib/conversation-contacts";
import type { ActivityAction } from "@/lib/conversations";
import type { DbTransaction } from "./client";
import { assistantActivity, calls, contacts, conversations, inboundEmails, messages, tickets } from "./schema";

// Linking what reaches the company to Inbox conversations (step 47), inside
// the transaction that saves it: a call when it is saved, a received email
// when it becomes a ticket. Nothing is copied: a message row points at the
// call or the email, which keep their own (encrypted) content.

// The conversation of this contact, made (with the contact) on first use.
// Two saves at the same moment for a new contact both end on one
// conversation (ON CONFLICT DO NOTHING, then read).
export async function conversationForContactWithin(tx: DbTransaction, companyId: string, contact: ContactKey): Promise<string> {
  await tx
    .insert(contacts)
    .values({ companyId, channel: contact.channel, externalId: contact.externalId, displayName: contact.displayName })
    .onConflictDoNothing({ target: [contacts.companyId, contacts.channel, contacts.externalId] });
  const [found] = await tx
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.companyId, companyId), eq(contacts.channel, contact.channel), eq(contacts.externalId, contact.externalId)));
  await tx.insert(conversations).values({ companyId, contactId: found.id }).onConflictDoNothing({ target: [conversations.companyId, conversations.contactId] });
  const [conversation] = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.companyId, companyId), eq(conversations.contactId, found.id)));
  return conversation.id;
}

// A saved call joins its caller's conversation, as an entry of it.
export async function linkCallWithin(tx: DbTransaction, companyId: string, callId: string, contact: ContactKey): Promise<void> {
  const conversationId = await conversationForContactWithin(tx, companyId, contact);
  await tx.insert(messages).values({ companyId, conversationId, direction: "in", author: "customer", callId });
  await tx.update(calls).set({ conversationId }).where(and(eq(calls.id, callId), eq(calls.companyId, companyId)));
  await touchConversationWithin(tx, companyId, conversationId, false);
}

// A received email that became a ticket joins its sender's conversation, as
// an entry of it, and so does the ticket.
export async function linkInboundEmailWithin(
  tx: DbTransaction,
  companyId: string,
  link: { inboundEmailId: string; ticketId: string },
  contact: ContactKey,
): Promise<void> {
  const conversationId = await conversationForContactWithin(tx, companyId, contact);
  await tx.insert(messages).values({ companyId, conversationId, direction: "in", author: "customer", inboundEmailId: link.inboundEmailId });
  await tx.update(inboundEmails).set({ conversationId }).where(and(eq(inboundEmails.id, link.inboundEmailId), eq(inboundEmails.companyId, companyId)));
  await tx.update(tickets).set({ conversationId }).where(and(eq(tickets.id, link.ticketId), eq(tickets.companyId, companyId)));
  await touchConversationWithin(tx, companyId, conversationId, false);
  await recordActivityWithin(tx, companyId, conversationId, "email_made_request", null);
}

// After a call is decided: the assistant's line in its conversation, if the
// call has one (a hidden caller's has none).
export async function recordCallDecisionWithin(tx: DbTransaction, companyId: string, callId: string, madeTicket: boolean): Promise<void> {
  const [call] = await tx
    .select({ conversationId: calls.conversationId })
    .from(calls)
    .where(and(eq(calls.id, callId), eq(calls.companyId, companyId)));
  if (call?.conversationId) {
    await recordActivityWithin(tx, companyId, call.conversationId, madeTicket ? "call_needs_person" : "call_solved", null);
  }
}

// One line of the activity log: the assistant's (actor null) or a person's.
export async function recordActivityWithin(
  tx: DbTransaction,
  companyId: string,
  conversationId: string,
  action: ActivityAction,
  actorUserId: string | null,
): Promise<void> {
  await tx.insert(assistantActivity).values({ companyId, conversationId, action, actorUserId });
}

// Moves the conversation to the top of the Inbox; `fromCustomer` also starts
// the channel's reply window again (a chat message the customer wrote).
export async function touchConversationWithin(tx: DbTransaction, companyId: string, conversationId: string, fromCustomer: boolean): Promise<void> {
  await tx
    .update(conversations)
    .set(fromCustomer ? { lastActivityAt: sql`now()`, lastCustomerMessageAt: sql`now()` } : { lastActivityAt: sql`now()` })
    .where(and(eq(conversations.id, conversationId), eq(conversations.companyId, companyId)));
}
