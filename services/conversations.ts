import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  handBackConversation,
  insertCustomerChatMessage,
  insertPersonReply,
  recordReplyDelivery,
  takeOverConversation,
  type ConversationWriteOutcome,
} from "@/db/conversation-writes";
import { countConversations, latestEntries, listActivity, listConversations, openTicketsOf, type InboxView } from "@/db/conversations";
import type { ChatDeliveryOptions } from "@/lib/chat-delivery";
import { cutToLength } from "@/lib/cofounder/fact-proposals";
import { standInContact } from "@/lib/conversation-contacts";
import { decryptForDisplay, encryptText } from "@/lib/encryption";
import { conversationMessageContext } from "@/lib/encryption-contexts";
import type { FormResult } from "@/lib/form-result";
import { toPlainSingleLine } from "@/lib/plain-text";
import type { SessionContext } from "@/lib/session";
import { conversationInputSchema, replySchema } from "@/lib/validation/conversations";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";
import { sendToCustomer } from "./chat-send";

// The Inbox (step 47): the session company's conversations, taking one over
// and handing it back, and a person's reply to a chat customer. Everyone in
// the company works conversations, as they work tickets. One conversation's
// page: services/conversation-page.ts.

export type InboxRow = Awaited<ReturnType<typeof listConversations>>[number] & {
  // One line about the newest entry: a message's start, or "Phone call".
  preview: string;
  openTicket: { ticketNumber: number; subject: string } | null;
};

const PREVIEW_LENGTH = 120;

// One page of a view of the Inbox, and how many each view holds.
export async function getInboxForSession(session: SessionContext, view: InboxView, page: number) {
  const [rows, counts] = await Promise.all([listConversations(session.companyId, view, page), countConversations(session.companyId)]);
  const ids = rows.map((row) => row.id);
  const [latest, openTickets] = await Promise.all([latestEntries(session.companyId, ids), openTicketsOf(session.companyId, ids)]);
  const inbox: InboxRow[] = rows.map((row) => {
    const entry = latest.find((candidate) => candidate.conversationId === row.id);
    const ticket = openTickets.find((candidate) => candidate.conversationId === row.id);
    return {
      ...row,
      preview: entry ? describeEntry(session.companyId, entry) : "",
      openTicket: ticket ? { ticketNumber: ticket.ticketNumber, subject: ticket.subject } : null,
    };
  });
  return { rows: inbox, counts };
}

function describeEntry(companyId: string, entry: Awaited<ReturnType<typeof latestEntries>>[number]): string {
  if (entry.callId) {
    return "Phone call";
  }
  if (entry.inboundEmailId) {
    return "Email";
  }
  const shown = decryptForDisplay(entry.bodyEncrypted, conversationMessageContext(companyId, entry.id));
  const text = shown.unreadable ? "(could not be decrypted)" : cutToLength(toPlainSingleLine(shown.text ?? ""), PREVIEW_LENGTH);
  return entry.author === "customer" ? text : `${entry.author === "assistant" ? "ansa" : "You"}: ${text}`;
}

// A person takes the conversation over from ansa.
export async function takeOverForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  return changeHandler(session, input, takeOverConversation);
}

// A person hands the conversation back to ansa.
export async function handBackForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  return changeHandler(session, input, handBackConversation);
}

async function changeHandler(
  session: SessionContext,
  input: unknown,
  change: (companyId: string, userId: string, conversationId: string) => Promise<ConversationWriteOutcome>,
): Promise<FormResult> {
  const parsed = conversationInputSchema.safeParse(input);
  if (!parsed.success) {
    return notFound();
  }
  if (await isOverRateLimit("inbox-changes", session.userId, RATE_LIMITS.inboxChangesPerUser)) {
    return tooManyChanges();
  }
  const outcome = await change(session.companyId, session.userId, parsed.data.conversationId);
  return outcome === "saved" || outcome === "unchanged" ? { ok: true } : outcome === "not-found" ? notFound() : notAllowed();
}

// Sends a person's reply to a chat customer: saved first ("sending",
// encrypted), then delivered through the channel, and its delivery recorded.
// Replying takes the conversation over from ansa. Once saved it counts as
// done: a reply the channel couldn't take says so under it on the page
// ("Not sent"), and the box empties, so nobody sends it twice. A Telegram
// reply that can't go (not connected, not allowed, or past Telegram's 24
// hours) is refused before anything is saved, and the box keeps it.
// `delivery` is only passed by the checks (Telegram's mode and a fake fetch).
export async function replyForSession(session: SessionContext, input: unknown, delivery: ChatDeliveryOptions = {}): Promise<FormResult> {
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  if (await isOverRateLimit("inbox-changes", session.userId, RATE_LIMITS.inboxChangesPerUser)) {
    return tooManyChanges();
  }
  const messageId = randomUUID();
  const bodyEncrypted = encryptText(parsed.data.text, conversationMessageContext(session.companyId, messageId));
  const saved = await insertPersonReply(session.companyId, session.userId, {
    conversationId: parsed.data.conversationId,
    messageId,
    bodyEncrypted,
    replacesDraftId: parsed.data.replacesDraftId,
  });
  if (saved === "not-found") {
    return notFound();
  }
  if (saved === "not-allowed") {
    return notAllowed();
  }
  if (saved === "not-chat") {
    return { ok: false, errors: { message: "Calls and emails can't be answered from ansa yet." } };
  }
  if (typeof saved === "string") {
    return { ok: false, errors: { message: REPLY_REFUSALS[saved] } };
  }
  const result = await sendToCustomer(session.companyId, saved, { id: messageId, text: parsed.data.text }, delivery);
  await recordReplyDelivery(session.companyId, messageId, result);
  return { ok: true };
}

// Why a Telegram reply can't go (step 48), before anything is saved.
const REPLY_REFUSALS = {
  "not-connected": "Telegram isn't connected. Connect it in Settings → Connections.",
  "cannot-reply": "ansa isn't allowed to reply on your Telegram account. Allow it in Telegram Business → Chatbots.",
  "window-closed": "Telegram lets ansa reply only within 24 hours of the customer's last message. Answer them in your Telegram app instead.",
} as const;

// A stand-in chat customer's message (pnpm simulate:message, development
// only), as Telegram's and Messenger's arrive. Each call is a new message.
// Returns where it was saved (the script then lets the assistant answer).
export async function receiveStandInMessage(companyId: string, from: string, text: string) {
  const messageId = randomUUID();
  return insertCustomerChatMessage(companyId, standInContact(from), {
    messageId,
    bodyEncrypted: encryptText(text, conversationMessageContext(companyId, messageId)),
    channelMessageId: `stand-in-${messageId}`,
  });
}

function notFound(): FormResult {
  return { ok: false, errors: { message: "This conversation isn't there any more. Reload the page." } };
}

function notAllowed(): FormResult {
  return { ok: false, errors: { message: "You can no longer work this company's conversations." } };
}

function tooManyChanges(): FormResult {
  return { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };
}

// Home's "What ansa did": the assistant's newest work, never a message's text.
export async function getAssistantActivityForSession(session: SessionContext) {
  return listActivity(session.companyId, { assistantOnly: true }, 6);
}
