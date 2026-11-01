import { escapeHtml } from "@/lib/escape-html";
import { redactSecretNumbers } from "@/lib/redaction";

// The order rules and tags of the restaurant assistant's request (step 52).
// The AI names dishes by their menu label and how many; ansa prices the
// order, writes the summary and the total, and places it when the customer
// says yes (lib/orders.ts). Pure.

export const ORDER_RULES = [
  "Orders: <ordering> says whether the restaurant takes orders through this chat. If not, someone who wants to order or book gets action needs_person (order).",
  "If it does, take the order yourself. Collect which dishes (only from <menu>, by their label) and how many, delivery or pickup (only what <ordering> offers), the address for a delivery, when they want it, and any notes. Ask for what is missing, one short question at a time. A dish that isn't on the menu: say so and offer what is. While <hours> says it is closed now, take no order: say when it opens.",
  "Once you have the dishes and delivery or pickup (and the address for a delivery), use action order_summary with the WHOLE order in `order` (labels and quantities; time empty if they didn't say) and leave reply empty. ansa then writes the summary with the prices and the total and asks the customer to confirm. Never write a total, a sum or an order summary yourself.",
  "When the customer clearly says yes to ansa's order summary (the restaurant's newest message, with 'Here is your order'), use action order_confirmed. If they change something first, order_summary again with the whole new order; if they no longer want it, order_withdrawn. Booking a table is always needs_person (order).",
  "An order in <placed_orders> they want to change or cancel: needs_person (order_change). Questions about where a placed order is: answer from <placed_orders>.",
  "For every action but order_summary, leave order's items empty and its texts empty.",
].join("\n");

// What the restaurant offers for orders, besides <ordering>'s notes.
export type OrderContext = {
  takesOrders: boolean;
  // "€2.50", or null for free delivery.
  deliveryFee: string | null;
  // The order being written up ("2 × Margherita (M1)", "Delivery to ..."), or none.
  inProgress: string[];
  // This conversation's newest placed orders, one line each ("#18: accepted, 2 × Margherita").
  placed: string[];
};

export function orderingExtraLines(orders: OrderContext, delivery: boolean): string[] {
  return [
    `Orders through this chat: ${orders.takesOrders ? "yes" : "no"}`,
    ...(delivery ? [`Delivery fee: ${orders.deliveryFee ? escapeHtml(orders.deliveryFee) : "none"}`] : []),
  ];
}

export function orderTags(orders: OrderContext): string[] {
  return [
    `<order_in_progress>\n${orders.inProgress.map(ownerLine).join("\n") || "None."}\n</order_in_progress>`,
    `<placed_orders>\n${orders.placed.map(ownerLine).join("\n") || "None."}\n</placed_orders>`,
  ];
}

// ansa's own words about an order (dish names are the owner's, an address
// the customer's): card-like numbers hidden, escaped.
function ownerLine(text: string): string {
  return escapeHtml(redactSecretNumbers(text));
}
