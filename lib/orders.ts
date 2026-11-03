// Orders (step 52): the words the screens use for an order's status. Core
// prices every order and writes every text a customer gets
// (core/internal/orders: the summary, questions, confirmation and status
// messages, in English or Bangla); the screens only show them.

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

// An order's status as the Orders page's button named it: "ready" is "On
// its way" for a delivery and "Ready to pick up" for a pickup.
export function orderStatusLabel(status: OrderStatus, fulfilment: Fulfilment): string {
  if (status !== "ready") {
    return ORDER_STATUS_LABELS[status];
  }
  return fulfilment === "delivery" ? "On its way" : "Ready to pick up";
}
