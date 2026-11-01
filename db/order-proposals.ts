import "server-only";
import { and, eq, inArray, max, sql } from "drizzle-orm";
import type { ChatTarget } from "@/lib/chat-delivery";
import type { PricedOrder } from "@/lib/orders";
import { gateWithin, markHandledWithin, type AssistantGate, type AssistantTurn } from "./assistant-runs";
import { chatTargetWithin } from "./chat-targets";
import { db, type DbTransaction } from "./client";
import { lockCompanyRow } from "./company-lock";
import { recordActivityWithin, touchConversationWithin } from "./conversation-links";
import { messages, orderItems, orders } from "./schema";

// The assistant's side of an order (step 52), each in ONE transaction that
// checks the conversation again (db/assistant-runs.ts's gate: paused, taken
// over, a request open, a newer message = nothing at all): ansa's summary
// saved with the order it describes ("proposed", replacing one written
// before), the customer's yes placing it under a number, or their no
// taking it back. Every query matches the company.

type GateRefusal = Exclude<AssistantGate, "may">;

export type ProposalToSave = {
  // A new id: the address and notes are encrypted for it (orderFieldContext).
  orderId: string;
  order: PricedOrder;
  addressEncrypted: string | null;
  notesEncrypted: string | null;
};

// ansa's summary (sent, or waiting in "Ask me first") and its order, which
// replaces the one this conversation was writing up.
export async function saveOrderProposal(
  turn: AssistantTurn,
  summary: { messageId: string; bodyEncrypted: string; waitForPerson: boolean },
  proposal: ProposalToSave,
): Promise<ChatTarget | "draft" | GateRefusal> {
  return db.transaction(async (tx) => {
    const gate = await gateWithin(tx, turn, { requireNewest: true, lock: true });
    if (gate !== "may") {
      return gate;
    }
    await discardWaitingDraftsWithin(tx, turn);
    await tx.insert(messages).values({
      id: summary.messageId,
      companyId: turn.companyId,
      conversationId: turn.conversationId,
      direction: "out",
      author: "assistant",
      bodyEncrypted: summary.bodyEncrypted,
      sendStatus: summary.waitForPerson ? "draft" : "sending",
    });
    await deleteProposalWithin(tx, turn);
    await insertProposalWithin(tx, turn, summary.messageId, proposal);
    await markHandledWithin(tx, turn);
    await recordActivityWithin(tx, turn.companyId, turn.conversationId, summary.waitForPerson ? "drafted" : "replied", null);
    await touchConversationWithin(tx, turn.companyId, turn.conversationId, false);
    return summary.waitForPerson ? "draft" : await chatTargetWithin(tx, turn);
  });
}

export type PlacedOrder = { orderId: string; orderNumber: number; totalCents: number; currency: string; target: ChatTarget };

// The customer said yes: the proposed order whose summary reached them gets
// the company's next number and is "new" (the Orders page), and ansa's
// confirmation (encrypted by `confirmation` for that number) is saved to be
// sent. The company row lock first, as for ticket numbers and handovers.
export async function placeProposedOrder(
  turn: AssistantTurn,
  confirmation: { messageId: string; encryptFor: (orderNumber: number) => string },
): Promise<PlacedOrder | "no-proposal" | GateRefusal> {
  return db.transaction(async (tx) => {
    await lockCompanyRow(tx, turn.companyId);
    const gate = await gateWithin(tx, turn, { requireNewest: true, lock: true });
    if (gate !== "may") {
      return gate;
    }
    const proposal = await shownProposalWithin(tx, turn);
    if (!proposal) {
      return "no-proposal";
    }
    const [highest] = await tx.select({ number: max(orders.orderNumber) }).from(orders).where(eq(orders.companyId, turn.companyId));
    const orderNumber = (highest?.number ?? 0) + 1;
    await tx
      .update(orders)
      .set({ status: "new", orderNumber, placedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(orders.id, proposal.id), eq(orders.companyId, turn.companyId), eq(orders.status, "proposed")));
    await tx.insert(messages).values({
      id: confirmation.messageId,
      companyId: turn.companyId,
      conversationId: turn.conversationId,
      direction: "out",
      author: "assistant",
      bodyEncrypted: confirmation.encryptFor(orderNumber),
      sendStatus: "sending",
    });
    await markHandledWithin(tx, turn);
    await recordActivityWithin(tx, turn.companyId, turn.conversationId, "order_placed", null);
    await touchConversationWithin(tx, turn.companyId, turn.conversationId, false);
    return { orderId: proposal.id, orderNumber, totalCents: proposal.totalCents, currency: proposal.currency, target: await chatTargetWithin(tx, turn) };
  });
}

// The customer doesn't want the order after all: it goes (with its lines),
// and ansa's fixed answer is saved to be sent.
export async function withdrawProposal(turn: AssistantTurn, answer: { messageId: string; bodyEncrypted: string }): Promise<ChatTarget | GateRefusal> {
  return db.transaction(async (tx) => {
    const gate = await gateWithin(tx, turn, { requireNewest: true, lock: true });
    if (gate !== "may") {
      return gate;
    }
    await deleteProposalWithin(tx, turn);
    await tx.insert(messages).values({
      id: answer.messageId,
      companyId: turn.companyId,
      conversationId: turn.conversationId,
      direction: "out",
      author: "assistant",
      bodyEncrypted: answer.bodyEncrypted,
      sendStatus: "sending",
    });
    await markHandledWithin(tx, turn);
    await recordActivityWithin(tx, turn.companyId, turn.conversationId, "replied", null);
    await touchConversationWithin(tx, turn.companyId, turn.conversationId, false);
    return chatTargetWithin(tx, turn);
  });
}

async function insertProposalWithin(tx: DbTransaction, turn: AssistantTurn, summaryMessageId: string, proposal: ProposalToSave): Promise<void> {
  const { order } = proposal;
  await tx.insert(orders).values({
    id: proposal.orderId,
    companyId: turn.companyId,
    conversationId: turn.conversationId,
    status: "proposed",
    fulfilment: order.fulfilment,
    wantedTime: order.time,
    currency: order.currency,
    subtotalCents: order.subtotalCents,
    deliveryFeeCents: order.deliveryFeeCents,
    totalCents: order.totalCents,
    addressEncrypted: proposal.addressEncrypted,
    notesEncrypted: proposal.notesEncrypted,
    summaryMessageId,
  });
  await tx.insert(orderItems).values(
    order.lines.map((line, index) => ({
      companyId: turn.companyId,
      orderId: proposal.orderId,
      position: index + 1,
      name: line.name,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: line.lineTotalCents,
    })),
  );
}

async function deleteProposalWithin(tx: DbTransaction, turn: AssistantTurn): Promise<void> {
  await tx
    .delete(orders)
    .where(and(eq(orders.companyId, turn.companyId), eq(orders.conversationId, turn.conversationId), eq(orders.status, "proposed")));
}

// The order being written up, only once its summary reached the customer
// (not still waiting for a person's Send, nor discarded): what they say yes to.
async function shownProposalWithin(tx: DbTransaction, turn: AssistantTurn) {
  const [proposal] = await tx
    .select({ id: orders.id, totalCents: orders.totalCents, currency: orders.currency })
    .from(orders)
    .innerJoin(messages, and(eq(messages.id, orders.summaryMessageId), eq(messages.companyId, orders.companyId)))
    .where(
      and(
        eq(orders.companyId, turn.companyId),
        eq(orders.conversationId, turn.conversationId),
        eq(orders.status, "proposed"),
        inArray(messages.sendStatus, ["sending", "sent", "unclear"]),
      ),
    )
    .for("update", { of: orders });
  return proposal ?? null;
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
