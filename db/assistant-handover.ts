import "server-only";
import { and, eq } from "drizzle-orm";
import type { HandoverReason } from "@/lib/assistant/reasons";
import type { ChatTarget } from "@/lib/chat-delivery";
import { gateWithin, markHandledWithin, type AssistantTurn } from "./assistant-runs";
import { chatTargetWithin } from "./chat-targets";
import { db } from "./client";
import { lockCompanyRow } from "./company-lock";
import { touchConversationWithin } from "./conversation-links";
import { assistantActivity, messages, tickets } from "./schema";
import { insertTicketWithNextNumber } from "./ticket-creation";

// The assistant hands a conversation to a person (step 49), in ONE
// transaction: the restaurant's holding reply (never the AI's text) saved
// to be sent, a request ("Needs you") routed like every new ticket, and the
// activity line with the reason. Checked again first: paused, taken over or
// a request already open = nothing at all (one holding reply until a
// person answers). The company row lock comes first, as for every
// transaction that routes (db/routing.ts).

export type HandoverToSave = {
  reason: HandoverReason;
  // The holding reply, encrypted for its message id; null when the channel
  // can't take a message anyway (the reply itself just failed to send).
  holdingReply: { messageId: string; bodyEncrypted: string } | null;
  request: { subject: string; description: string; categoryId: string | null; customerName: string | null };
};

export type SavedHandover = { target: ChatTarget | null; ticketId: string; assignedToUserId: string | null };

export async function saveHandover(turn: AssistantTurn, handover: HandoverToSave): Promise<SavedHandover | "skipped"> {
  return db.transaction(async (tx) => {
    await lockCompanyRow(tx, turn.companyId);
    // A newer message arriving meanwhile doesn't stop a handover: the
    // customer still waits for an answer, and its own run then finds the request.
    const gate = await gateWithin(tx, turn, { requireNewest: false, lock: true, allowHandled: handover.reason === "send_failed" });
    if (gate !== "may") {
      return "skipped";
    }
    if (handover.holdingReply) {
      await tx.insert(messages).values({
        id: handover.holdingReply.messageId,
        companyId: turn.companyId,
        conversationId: turn.conversationId,
        direction: "out",
        author: "assistant",
        bodyEncrypted: handover.holdingReply.bodyEncrypted,
        sendStatus: "sending",
      });
    }
    const ticket = await insertTicketWithNextNumber(
      tx,
      turn.companyId,
      {
        subject: handover.request.subject,
        description: handover.request.description,
        channel: "chat",
        category: null,
        categoryId: handover.request.categoryId,
        customerName: handover.request.customerName,
        customerEmail: null,
        customerPhone: null,
      },
      null,
    );
    await tx
      .update(tickets)
      .set({ conversationId: turn.conversationId })
      .where(and(eq(tickets.id, ticket.id), eq(tickets.companyId, turn.companyId)));
    await tx.insert(assistantActivity).values({
      companyId: turn.companyId,
      conversationId: turn.conversationId,
      action: "handed_over",
      reason: handover.reason,
      actorUserId: null,
    });
    await markHandledWithin(tx, turn);
    await touchConversationWithin(tx, turn.companyId, turn.conversationId, false);
    return {
      target: handover.holdingReply ? await chatTargetWithin(tx, turn) : null,
      ticketId: ticket.id,
      assignedToUserId: ticket.assignedToUserId,
    };
  });
}
