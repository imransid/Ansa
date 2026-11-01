import "server-only";
import { callCore } from "@/lib/core-api";
import type { OrderView } from "@/services/orders";

// The Orders page through the new backend (core's GET /api/v1/orders),
// in the shape the page already reads.

type CoreOrder = Omit<OrderView, "orderNumber" | "placedAt"> & { number: number; placedAt: string | null };

function toOrderView(order: CoreOrder): OrderView {
  const { number, placedAt, ...rest } = order;
  return { ...rest, orderNumber: number, placedAt: placedAt ? new Date(placedAt) : null };
}

export async function getOrdersPageFromCore(): Promise<{ open: OrderView[]; finished: OrderView[] }> {
  const answer = await callCore<{ open: CoreOrder[]; finished: CoreOrder[] }>("GET", "/api/v1/orders");
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  return { open: answer.data.open.map(toOrderView), finished: answer.data.finished.map(toOrderView) };
}

// Whether the business takes orders (the Orders page's notice).
export async function takesOrdersFromCore(): Promise<boolean> {
  const answer = await callCore<{ settings: { takesOrders: boolean } }>("GET", "/api/v1/settings/assistant");
  return answer.ok ? answer.data.settings.takesOrders : true;
}

// One button's change; a notice when the customer wasn't messaged.
export async function changeOrderStatusThroughCore(orderId: string, change: string): Promise<{ ok: true; notice: string } | { ok: false; message: string }> {
  const answer = await callCore<{ notice: string }>("POST", `/api/v1/orders/${encodeURIComponent(orderId)}/status`, { change });
  return answer.ok ? { ok: true, notice: answer.data.notice } : { ok: false, message: answer.message };
}
