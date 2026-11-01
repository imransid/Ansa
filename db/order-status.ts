import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { ChatTarget } from "@/lib/chat-delivery";
import type { Fulfilment, OrderStatus } from "@/lib/orders";
import { db } from "./client";
import { touchConversationWithin } from "./conversation-links";
import { lockActiveAuthorRole } from "./knowledge-author";
import { lockReplyRouteWithin, type ReplyRefusal } from "./reply-routes";
import { messages, orders } from "./schema";

// A person moves an order on (step 52, the Orders page): Accept, Ready,
// Done or Cancel. Anyone in the company works orders, as they work
// conversations (the person read again, FOR SHARE). The status is checked
// in the UPDATE itself, so two people pressing at once change it once.
// The customer's short fixed message is saved in the same transaction, to
// be sent, when the conversation's channel may take one now; a person's
// message, which doesn't take the conversation over from ansa.

// What the page needs to write the message before the change: a number and
// a way of delivery never change once an order is placed.
export async function readPlacedOrder(companyId: string, orderId: string) {
  const [order] = await db
    .select({ id: orders.id, orderNumber: orders.orderNumber, status: orders.status, fulfilment: orders.fulfilment, conversationId: orders.conversationId })
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.companyId, companyId)));
  return order && order.orderNumber !== null ? { ...order, orderNumber: order.orderNumber, fulfilment: order.fulfilment as Fulfilment } : null;
}

export type OrderStatusOutcome = { kind: "changed"; target: ChatTarget | null; refusal: ReplyRefusal | null } | { kind: "not-allowed" } | { kind: "changed-meanwhile" };

export async function changeOrderStatus(
  companyId: string,
  actorUserId: string,
  change: { orderId: string; from: OrderStatus[]; to: OrderStatus },
  message: { id: string; bodyEncrypted: string },
): Promise<OrderStatusOutcome> {
  return db.transaction(async (tx) => {
    if (!(await lockActiveAuthorRole(tx, companyId, actorUserId))) {
      return { kind: "not-allowed" };
    }
    const [changed] = await tx
      .update(orders)
      .set({ status: change.to, updatedByUserId: actorUserId, updatedAt: sql`now()` })
      .where(and(eq(orders.id, change.orderId), eq(orders.companyId, companyId), inArray(orders.status, change.from)))
      .returning({ conversationId: orders.conversationId });
    if (!changed) {
      return { kind: "changed-meanwhile" };
    }
    const route = await lockReplyRouteWithin(tx, companyId, changed.conversationId);
    if (typeof route === "string") {
      return { kind: "changed", target: null, refusal: route };
    }
    await tx.insert(messages).values({
      id: message.id,
      companyId,
      conversationId: changed.conversationId,
      direction: "out",
      author: "person",
      authorUserId: actorUserId,
      bodyEncrypted: message.bodyEncrypted,
      sendStatus: "sending",
    });
    await touchConversationWithin(tx, companyId, changed.conversationId, false);
    return { kind: "changed", target: route.target, refusal: null };
  });
}
