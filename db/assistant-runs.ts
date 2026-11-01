import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { ChatTarget } from "@/lib/chat-delivery";
import { chatTargetWithin } from "./chat-targets";
import { db, type DbTransaction } from "./client";
import { recordActivityWithin, touchConversationWithin } from "./conversation-links";
import { assistantSettings, contacts, conversations, messages, tickets } from "./schema";

// What the restaurant assistant may do in one conversation (step 49), read
// again inside the transaction that writes, so a Pause, a Take over, a
// request opened or a newer message arriving while Claude thought always
// wins: nothing is saved or sent then. Every query matches the company.

export type AssistantTurn = { companyId: string; conversationId: string; triggerMessageId: string };

// Why the assistant stays quiet, or "may" when it may answer.
export type AssistantGate = "may" | "paused" | "taken-over" | "needs-person" | "not-newest" | "handled" | "not-found";

export type ConversationForAssistant = {
  channel: ChatTarget["channel"];
  externalId: string;
  contactName: string | null;
  // Someone the owner marked important (step 51): always handed to them.
  important: boolean;
  // Nothing automated was sent here before: the next message gets the AI label.
  isFirstAutomatedMessage: boolean;
};

// Whether the assistant may answer the trigger message now (read outside a
// transaction, before asking Claude), with what the run needs.
export async function readAssistantGate(turn: AssistantTurn): Promise<{ gate: AssistantGate; conversation: ConversationForAssistant | null }> {
  return db.transaction(async (tx) => {
    const gate = await gateWithin(tx, turn, { requireNewest: true, lock: false });
    return { gate, conversation: gate === "not-found" ? null : await conversationForAssistantWithin(tx, turn) };
  });
}

// Saves the assistant's reply: "sending" (Automatic) or a "draft" that
// waits for a person (Ask me first; a draft waiting before is discarded),
// with its activity line, in one transaction that checks everything again.
// Returns where to send it, "draft" or why nothing was saved.
export async function saveAssistantReply(
  turn: AssistantTurn,
  reply: { messageId: string; bodyEncrypted: string; waitForPerson: boolean },
): Promise<ChatTarget | "draft" | Exclude<AssistantGate, "may">> {
  return db.transaction(async (tx) => {
    const gate = await gateWithin(tx, turn, { requireNewest: true, lock: true });
    if (gate !== "may") {
      return gate;
    }
    await discardWaitingDraftsWithin(tx, turn);
    await tx.insert(messages).values({
      id: reply.messageId,
      companyId: turn.companyId,
      conversationId: turn.conversationId,
      direction: "out",
      author: "assistant",
      bodyEncrypted: reply.bodyEncrypted,
      sendStatus: reply.waitForPerson ? "draft" : "sending",
    });
    await markHandledWithin(tx, turn);
    await recordActivityWithin(tx, turn.companyId, turn.conversationId, reply.waitForPerson ? "drafted" : "replied", null);
    await touchConversationWithin(tx, turn.companyId, turn.conversationId, false);
    return reply.waitForPerson ? "draft" : await chatTargetWithin(tx, turn);
  });
}

// You may still answer yourself (step 51): the scheduled runs look at this
// conversation again in `minutes` (db/assistant-due.ts). A conversation
// already waiting keeps its earlier time.
export async function scheduleAssistantCheck(turn: AssistantTurn, minutes: number): Promise<void> {
  await db
    .update(conversations)
    .set({ assistantDueAt: sql`now() + make_interval(mins => ${minutes})` })
    .where(and(eq(conversations.id, turn.conversationId), eq(conversations.companyId, turn.companyId), isNull(conversations.assistantDueAt)));
}

// The assistant decided to say nothing (a thank you, or the customer's
// hourly limit): the message counts as handled, so it isn't asked again.
export async function markAssistantHandled(turn: AssistantTurn): Promise<void> {
  await db.transaction((tx) => markHandledWithin(tx, turn));
}

// The checks the gate makes, in order. `lock`: the conversation row is
// locked until the transaction ends (a write follows). `allowHandled`: the
// assistant's own reply to this message just failed to send, and a person
// is asked after all.
export async function gateWithin(
  tx: DbTransaction,
  turn: AssistantTurn,
  options: { requireNewest: boolean; lock: boolean; allowHandled?: boolean },
): Promise<AssistantGate> {
  const query = tx
    .select({ handledBy: conversations.handledBy, handledMessageId: conversations.assistantHandledMessageId })
    .from(conversations)
    .where(and(eq(conversations.id, turn.conversationId), eq(conversations.companyId, turn.companyId)));
  const [conversation] = options.lock ? await query.for("update") : await query;
  if (!conversation) {
    return "not-found";
  }
  const [settings] = await tx
    .select({ status: assistantSettings.status })
    .from(assistantSettings)
    .where(eq(assistantSettings.companyId, turn.companyId))
    .for("share");
  if (settings?.status === "paused") {
    return "paused";
  }
  if (conversation.handledBy === "person") {
    return "taken-over";
  }
  if (conversation.handledMessageId === turn.triggerMessageId && !options.allowHandled) {
    return "handled";
  }
  if (await hasOpenRequestWithin(tx, turn)) {
    return "needs-person";
  }
  if (options.requireNewest && (await newestCustomerMessageWithin(tx, turn)) !== turn.triggerMessageId) {
    return "not-newest";
  }
  return "may";
}

export async function markHandledWithin(tx: DbTransaction, turn: AssistantTurn): Promise<void> {
  await tx
    .update(conversations)
    .set({ assistantHandledMessageId: turn.triggerMessageId })
    .where(and(eq(conversations.id, turn.conversationId), eq(conversations.companyId, turn.companyId)));
}

async function conversationForAssistantWithin(tx: DbTransaction, turn: AssistantTurn): Promise<ConversationForAssistant> {
  const [contact] = await tx
    .select({ channel: contacts.channel, externalId: contacts.externalId, contactName: contacts.displayName, important: contacts.important })
    .from(conversations)
    .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.companyId, conversations.companyId)))
    .where(and(eq(conversations.id, turn.conversationId), eq(conversations.companyId, turn.companyId)));
  return { ...contact, isFirstAutomatedMessage: await isFirstAutomatedMessageWithin(tx, turn) };
}

// Nothing the assistant wrote went out, or waits, in this conversation yet.
export async function isFirstAutomatedMessageWithin(tx: DbTransaction, turn: AssistantTurn): Promise<boolean> {
  const [earlier] = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.companyId, turn.companyId),
        eq(messages.conversationId, turn.conversationId),
        eq(messages.author, "assistant"),
        inArray(messages.sendStatus, ["draft", "sending", "sent", "unclear"]),
      ),
    )
    .limit(1);
  return !earlier;
}

async function hasOpenRequestWithin(tx: DbTransaction, turn: AssistantTurn): Promise<boolean> {
  const [open] = await tx
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.companyId, turn.companyId), eq(tickets.conversationId, turn.conversationId), eq(tickets.status, "open")))
    .limit(1);
  return open !== undefined;
}

async function newestCustomerMessageWithin(tx: DbTransaction, turn: AssistantTurn): Promise<string | null> {
  const [newest] = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.companyId, turn.companyId),
        eq(messages.conversationId, turn.conversationId),
        eq(messages.direction, "in"),
        isNotNull(messages.bodyEncrypted),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return newest?.id ?? null;
}

async function discardWaitingDraftsWithin(tx: DbTransaction, turn: AssistantTurn): Promise<void> {
  await tx
    .update(messages)
    .set({ sendStatus: "discarded" })
    .where(
      and(
        eq(messages.companyId, turn.companyId),
        eq(messages.conversationId, turn.conversationId),
        eq(messages.author, "assistant"),
        eq(messages.sendStatus, "draft"),
      ),
    );
}
