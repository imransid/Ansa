import { formatPrice } from "@/lib/menu";

// Orders (step 52): what a customer orders in a chat, collected by the
// assistant and written up by ansa. The AI only names dishes by their menu
// labels and how many; every price, line and total here is ansa's own,
// from the menu as it is. Pure, so checks read every case.

// "proposed": the summary went to the customer, who hasn't said yes yet
// (one per conversation, no number, not on the Orders page). Then, once
// they said yes: new -> accepted -> ready -> done, or cancelled.
export const ORDER_STATUSES = ["proposed", "new", "accepted", "ready", "done", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const FULFILMENTS = ["delivery", "pickup"] as const;
export type Fulfilment = (typeof FULFILMENTS)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  proposed: "Waiting for the customer to say yes",
  new: "New",
  accepted: "Accepted",
  ready: "Ready",
  done: "Done",
  cancelled: "Cancelled",
};

// Limits, as the database's CHECKs repeat them.
export const ORDER_QUANTITY_MAX = 50;
export const ORDER_LINES_MAX = 30;
export const ORDER_ADDRESS_MAX_LENGTH = 300;
export const ORDER_TIME_MAX_LENGTH = 100;
export const ORDER_NOTES_MAX_LENGTH = 500;

// What the AI says the customer wants, by menu label (M1, M2...).
export type OrderRequest = {
  items: { label: string; quantity: number }[];
  fulfilment: Fulfilment | "";
  address: string;
  time: string;
  notes: string;
};

// A dish as the assistant's menu listed it.
export type MenuChoice = { label: string; name: string; priceCents: number };

// What the restaurant offers for orders (Settings → What it knows).
export type OrderingOptions = { delivery: boolean; pickup: boolean; deliveryFeeCents: number; currency: string };

export type OrderLine = { name: string; quantity: number; unitPriceCents: number; lineTotalCents: number };

export type PricedOrder = {
  lines: OrderLine[];
  fulfilment: Fulfilment;
  address: string;
  time: string;
  notes: string;
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  currency: string;
};

// Why ansa can't write up the order yet, each answered with a fixed
// question (orderQuestion) or, for a dish it can't place, a person.
export type OrderGap = "unknown_item" | "no_items" | "how" | "address";

// The order with ansa's prices and total, or what is missing. The same
// label twice adds up into one line.
export function priceOrder(request: OrderRequest, menu: MenuChoice[], options: OrderingOptions): PricedOrder | { gap: OrderGap } {
  const lines: OrderLine[] = [];
  for (const item of request.items) {
    const dish = menu.find((choice) => choice.label === item.label.trim().toUpperCase());
    if (!dish || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > ORDER_QUANTITY_MAX) {
      return { gap: "unknown_item" };
    }
    const existing = lines.find((line) => line.name === dish.name && line.unitPriceCents === dish.priceCents);
    if (existing) {
      existing.quantity = Math.min(existing.quantity + item.quantity, ORDER_QUANTITY_MAX);
      existing.lineTotalCents = existing.quantity * existing.unitPriceCents;
    } else {
      lines.push({ name: dish.name, quantity: item.quantity, unitPriceCents: dish.priceCents, lineTotalCents: item.quantity * dish.priceCents });
    }
  }
  if (lines.length === 0 || lines.length > ORDER_LINES_MAX) {
    return { gap: lines.length === 0 ? "no_items" : "unknown_item" };
  }
  const fulfilment = request.fulfilment === "delivery" && options.delivery ? "delivery" : request.fulfilment === "pickup" && options.pickup ? "pickup" : null;
  if (!fulfilment) {
    return { gap: "how" };
  }
  const address = request.address.trim();
  if (fulfilment === "delivery" && address === "") {
    return { gap: "address" };
  }
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const deliveryFeeCents = fulfilment === "delivery" ? options.deliveryFeeCents : 0;
  return {
    lines,
    fulfilment,
    address: fulfilment === "delivery" ? address : "",
    time: request.time.trim() || "As soon as possible",
    notes: request.notes.trim(),
    subtotalCents,
    deliveryFeeCents,
    totalCents: subtotalCents + deliveryFeeCents,
    currency: options.currency,
  };
}

// ansa's question for what is missing (never the AI's words).
export function orderQuestion(gap: Exclude<OrderGap, "unknown_item">, options: OrderingOptions): string {
  if (gap === "no_items") {
    return "What would you like to order?";
  }
  if (gap === "address") {
    return "Where should we deliver it? Please send the full address.";
  }
  if (options.delivery && options.pickup) {
    return "Would you like it delivered, or will you pick it up?";
  }
  return options.delivery ? "We deliver: where should we bring it? Please send the full address." : "We don't deliver, but you can pick it up. Is pickup all right?";
}

// The summary the customer says yes to: every line, the fee, the total,
// how and when. Written by ansa from the priced order.
export function orderSummaryText(order: PricedOrder): string {
  const money = (cents: number) => formatPrice(cents, order.currency);
  return [
    "Here is your order:",
    ...order.lines.map((line) => `${line.quantity} × ${line.name}: ${money(line.lineTotalCents)}`),
    ...(order.deliveryFeeCents > 0 ? [`Delivery: ${money(order.deliveryFeeCents)}`] : []),
    `Total: ${money(order.totalCents)}`,
    order.fulfilment === "delivery" ? `Delivery to: ${order.address}` : "Pickup",
    `When: ${order.time}`,
    ...(order.notes ? [`Notes: ${order.notes}`] : []),
    "",
    "Shall I place the order? Reply “yes” to confirm.",
  ].join("\n");
}

// The fixed messages the customer gets, each sent by ansa (never the AI).
export function orderPlacedText(orderNumber: number): string {
  return `Thank you! Your order #${orderNumber} is placed. We'll message you as soon as it's accepted.`;
}

export const ORDER_WITHDRAWN_TEXT = "No problem: nothing was ordered.";

export function orderClosedText(hoursNow: string): string {
  return `Sorry, we can't take orders right now (${hoursNow.toLowerCase()}).`;
}

// What a person's button sends the customer (Orders page).
export type OrderStatusChange = "accept" | "ready" | "done" | "cancel";

export const ORDER_NEXT_STATUS: Record<OrderStatusChange, { from: OrderStatus[]; to: OrderStatus }> = {
  accept: { from: ["new"], to: "accepted" },
  ready: { from: ["accepted"], to: "ready" },
  done: { from: ["accepted", "ready"], to: "done" },
  cancel: { from: ["new", "accepted", "ready"], to: "cancelled" },
};

export function orderStatusText(change: OrderStatusChange, orderNumber: number, fulfilment: Fulfilment, wasNew: boolean): string {
  if (change === "accept") {
    return `Your order #${orderNumber} is accepted. We're getting it ready.`;
  }
  if (change === "ready") {
    return fulfilment === "delivery" ? `Your order #${orderNumber} is on its way.` : `Your order #${orderNumber} is ready to pick up.`;
  }
  if (change === "done") {
    return `Thank you for your order #${orderNumber}!`;
  }
  return wasNew
    ? `Sorry, we can't take your order #${orderNumber}. Write to us here if you have any questions.`
    : `Sorry, your order #${orderNumber} was cancelled. Write to us here if you have any questions.`;
}

// An order as the assistant reads it: each line with its menu label when the
// dish is still on today's menu, how, where and when. Never an id.
export function describeOrderForAssistant(
  order: { fulfilment: Fulfilment; wantedTime: string; lines: { name: string; quantity: number }[] },
  menu: MenuChoice[],
): string[] {
  return [
    ...order.lines.map((line) => {
      const label = menu.find((choice) => choice.name === line.name)?.label;
      return `${line.quantity} × ${line.name}${label ? ` (${label})` : ""}`;
    }),
    order.fulfilment === "delivery" ? "delivery" : "pickup",
    `when: ${order.wantedTime}`,
  ];
}
