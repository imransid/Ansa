import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { recordReplyDelivery } from "@/db/conversation-writes";
import { changeOrderStatus, readPlacedOrder } from "@/db/order-status";
import { countNewOrders, listOrdersForPage, type OrderRow } from "@/db/orders";
import { getAssistantSettings } from "@/db/assistant-settings";
import { getCompanySetup } from "@/db/restaurant-setup";
import { decryptForDisplay, encryptText } from "@/lib/encryption";
import { conversationMessageContext, orderFieldContext } from "@/lib/encryption-contexts";
import type { FormResult } from "@/lib/form-result";
import { ORDER_NEXT_STATUS, orderStatusText, type OrderStatusChange } from "@/lib/orders";
import type { SessionContext } from "@/lib/session";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";
import { sendToCustomer } from "./chat-send";

// The Orders page (step 52): the session company's orders, and a person
// moving one on (Accept, Ready, Done, Cancel), which sends the customer one
// short fixed message when their chat may take it now. Everyone in the
// company works orders, as they work conversations.

export type OrderView = Omit<OrderRow, "addressEncrypted" | "notesEncrypted"> & { address: string | null; notes: string | null };

export async function getOrdersPageForSession(session: SessionContext) {
  const { open, finished } = await listOrdersForPage(session.companyId);
  const show = (row: OrderRow): OrderView => {
    const { addressEncrypted, notesEncrypted, ...rest } = row;
    return {
      ...rest,
      address: readField(session.companyId, row.id, "address", addressEncrypted),
      notes: readField(session.companyId, row.id, "notes", notesEncrypted),
    };
  };
  return { open: open.map(show), finished: finished.map(show) };
}

// How many new orders wait to be accepted (Home's "Needs you").
export async function countNewOrdersForSession(session: SessionContext): Promise<number> {
  return countNewOrders(session.companyId);
}

// Whether the sidebar shows Orders: a business that takes orders through ansa.
export async function companyTakesOrdersForSession(session: SessionContext): Promise<boolean> {
  const [company, settings] = await Promise.all([getCompanySetup(session.companyId), getAssistantSettings(session.companyId)]);
  return company.kind === "business" && (settings?.takesOrders ?? true);
}

function readField(companyId: string, orderId: string, field: "address" | "notes", encrypted: string | null): string | null {
  if (encrypted === null) {
    return null;
  }
  const shown = decryptForDisplay(encrypted, orderFieldContext(companyId, orderId, field));
  return shown.unreadable ? "(could not be decrypted)" : (shown.text ?? null);
}

const changeSchema = z.object({ orderId: z.uuid().transform((id) => id.toLowerCase()), change: z.enum(["accept", "ready", "done", "cancel"]) });

// Why the customer wasn't told, in plain words (the status still changed).
const NOT_TOLD: Record<string, string> = {
  "window-closed": "The customer wasn't messaged: Telegram lets ansa write only within 24 hours of their last message.",
  "not-connected": "The customer wasn't messaged: Telegram isn't connected.",
  "cannot-reply": "The customer wasn't messaged: ansa isn't allowed to reply on your Telegram account.",
  "not-chat": "The customer wasn't messaged: they didn't order in a chat.",
  "not-found": "The customer wasn't messaged.",
};

// Moves one order on, and tells the customer. The order's status is checked
// again when it is saved: a teammate's change meanwhile wins.
export async function changeOrderStatusForSession(session: SessionContext, input: unknown): Promise<FormResult & { notice?: string }> {
  const parsed = changeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "This order isn't there any more. Reload the page." } };
  }
  if (await isOverRateLimit("inbox-changes", session.userId, RATE_LIMITS.inboxChangesPerUser)) {
    return { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };
  }
  const order = await readPlacedOrder(session.companyId, parsed.data.orderId);
  const change: OrderStatusChange = parsed.data.change;
  if (!order) {
    return { ok: false, errors: { message: "This order isn't there any more. Reload the page." } };
  }
  const text = orderStatusText(change, order.orderNumber, order.fulfilment, order.status === "new");
  const messageId = randomUUID();
  const outcome = await changeOrderStatus(
    session.companyId,
    session.userId,
    { orderId: order.id, from: ORDER_NEXT_STATUS[change].from, to: ORDER_NEXT_STATUS[change].to },
    { id: messageId, bodyEncrypted: encryptText(text, conversationMessageContext(session.companyId, messageId)) },
  );
  if (outcome.kind === "not-allowed") {
    return { ok: false, errors: { message: "You can no longer work this company's orders." } };
  }
  if (outcome.kind === "changed-meanwhile") {
    return { ok: false, errors: { message: "Someone changed this order meanwhile. Reload the page." } };
  }
  if (!outcome.target) {
    return { ok: true, notice: NOT_TOLD[outcome.refusal ?? "not-found"] };
  }
  const delivery = await sendToCustomer(session.companyId, outcome.target, { id: messageId, text });
  await recordReplyDelivery(session.companyId, messageId, delivery);
  return delivery.status === "failed" ? { ok: true, notice: "The customer's message couldn't be sent: see the conversation." } : { ok: true };
}
