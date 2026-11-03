import "server-only";
import { callCore } from "@/lib/core-api";
import type { ConversationChannel } from "@/lib/conversations";
import { ORDER_NOT_TOLD_REASONS, type OrderNotToldReason } from "@/lib/order-notices";
import type { OrderView } from "@/lib/types/orders";

// The Orders page through the new backend (core's GET /api/v1/orders),
// in the shape the page already reads.

type CoreOrder = Omit<OrderView, "orderNumber" | "placedAt"> & { number: number; placedAt: string | null };

function toOrderView(order: CoreOrder): OrderView {
  const { number, placedAt, ...rest } = order;
  return { ...rest, orderNumber: number, placedAt: placedAt ? new Date(placedAt) : null };
}

// The orders, and whether the package includes orders (step 57: without,
// the assistant hands every order to a person as a request).
export async function getOrdersPageFromCore(): Promise<{ open: OrderView[]; finished: OrderView[]; packageIncludesOrders: boolean }> {
  const answer = await callCore<{ open: CoreOrder[]; finished: CoreOrder[]; packageIncludesOrders: boolean }>("GET", "/api/v1/orders");
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  const { open, finished, packageIncludesOrders } = answer.data;
  return { open: open.map(toOrderView), finished: finished.map(toOrderView), packageIncludesOrders };
}

// Whether the business takes orders (the Orders page's notice).
export async function takesOrdersFromCore(): Promise<boolean> {
  const answer = await callCore<{ settings: { takesOrders: boolean } }>("GET", "/api/v1/settings/assistant");
  return answer.ok ? answer.data.settings.takesOrders : true;
}

// Why the customer wasn't told about a change, the order's number and their channel.
export type OrderNotTold = { reason: OrderNotToldReason; number: number; channel: ConversationChannel };

// One button's change; when the customer wasn't messaged, why (core's
// code: one this page doesn't know yet still says they weren't told).
export async function changeOrderStatusThroughCore(orderId: string, change: string): Promise<{ ok: true; notTold: OrderNotTold | null } | { ok: false; message: string }> {
  const answer = await callCore<{ notTold: string; number: number; channel: ConversationChannel }>("POST", `/api/v1/orders/${encodeURIComponent(orderId)}/status`, { change });
  if (!answer.ok) {
    return { ok: false, message: answer.message };
  }
  const { notTold, number, channel } = answer.data;
  if (!notTold) {
    return { ok: true, notTold: null };
  }
  const reason = ORDER_NOT_TOLD_REASONS.find((known) => known === notTold) ?? "not-found";
  return { ok: true, notTold: { reason, number, channel } };
}
