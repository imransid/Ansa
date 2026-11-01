import "server-only";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import type { ConversationChannel } from "@/lib/conversations";
import type { Fulfilment, OrderStatus } from "@/lib/orders";
import { db } from "./client";
import { contacts, conversations, orderItems, orders } from "./schema";

// Reading orders (step 52): the Orders page's lists, Home's count of new
// ones, and what the assistant reads about one conversation's orders. Every
// query matches the company. Status changes: db/order-status.ts; what the
// assistant writes: db/order-proposals.ts.

export type OrderRow = {
  id: string;
  conversationId: string;
  orderNumber: number | null;
  status: OrderStatus;
  fulfilment: Fulfilment;
  addressEncrypted: string | null;
  notesEncrypted: string | null;
  wantedTime: string;
  currency: string;
  deliveryFeeCents: number;
  totalCents: number;
  placedAt: Date | null;
  contactName: string | null;
  channel: ConversationChannel;
  lines: { name: string; quantity: number; lineTotalCents: number }[];
};

// How many orders each list of the page shows.
const OPEN_ORDERS_SHOWN = 100;
const FINISHED_ORDERS_SHOWN = 30;

// The Orders page: the orders still to do (oldest first: first come, first
// served), and the newest finished or cancelled ones.
export async function listOrdersForPage(companyId: string): Promise<{ open: OrderRow[]; finished: OrderRow[] }> {
  const [open, finished] = await Promise.all([
    readOrders(companyId, ["new", "accepted", "ready"], "oldest", OPEN_ORDERS_SHOWN),
    readOrders(companyId, ["done", "cancelled"], "newest", FINISHED_ORDERS_SHOWN),
  ]);
  return { open, finished };
}

// New orders nobody accepted yet: Home's "Needs you".
export async function countNewOrders(companyId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(orders)
    .where(and(eq(orders.companyId, companyId), eq(orders.status, "new")));
  return row?.total ?? 0;
}

// One conversation's order being written up and its newest placed ones.
export async function ordersOfConversation(companyId: string, conversationId: string, placedShown = 3) {
  const rows = await readOrders(companyId, ["proposed", "new", "accepted", "ready", "done", "cancelled"], "newest", placedShown + 1, conversationId);
  return { proposal: rows.find((row) => row.status === "proposed") ?? null, placed: rows.filter((row) => row.status !== "proposed").slice(0, placedShown) };
}

async function readOrders(companyId: string, statuses: OrderStatus[], order: "oldest" | "newest", limit: number, conversationId?: string): Promise<OrderRow[]> {
  const rows = await db
    .select({
      id: orders.id,
      conversationId: orders.conversationId,
      orderNumber: orders.orderNumber,
      status: orders.status,
      fulfilment: orders.fulfilment,
      addressEncrypted: orders.addressEncrypted,
      notesEncrypted: orders.notesEncrypted,
      wantedTime: orders.wantedTime,
      currency: orders.currency,
      deliveryFeeCents: orders.deliveryFeeCents,
      totalCents: orders.totalCents,
      placedAt: orders.placedAt,
      contactName: contacts.displayName,
      channel: contacts.channel,
    })
    .from(orders)
    .innerJoin(conversations, and(eq(conversations.id, orders.conversationId), eq(conversations.companyId, orders.companyId)))
    .innerJoin(contacts, and(eq(contacts.id, conversations.contactId), eq(contacts.companyId, conversations.companyId)))
    .where(
      and(
        eq(orders.companyId, companyId),
        inArray(orders.status, statuses),
        conversationId ? eq(orders.conversationId, conversationId) : undefined,
      ),
    )
    .orderBy(order === "oldest" ? asc(orders.placedAt) : desc(orders.createdAt), asc(orders.id))
    .limit(limit);
  const lines = await linesOf(companyId, rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, lines: lines.filter((line) => line.orderId === row.id) }));
}

async function linesOf(companyId: string, orderIds: string[]) {
  if (orderIds.length === 0) {
    return [];
  }
  return db
    .select({ orderId: orderItems.orderId, name: orderItems.name, quantity: orderItems.quantity, lineTotalCents: orderItems.lineTotalCents })
    .from(orderItems)
    .where(and(eq(orderItems.companyId, companyId), inArray(orderItems.orderId, orderIds)))
    .orderBy(asc(orderItems.position));
}
