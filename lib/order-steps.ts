import type { AssistantAnswer } from "@/lib/assistant/answer";
import { ORDER_WITHDRAWN_TEXT, orderClosedText, orderQuestion, orderSummaryText, priceOrder, type MenuChoice, type OrderingOptions, type PricedOrder } from "@/lib/orders";
import type { CompanyKind } from "@/lib/restaurant-setup";

// What ansa does with the assistant's order answer (step 52), before
// anything is saved: hand over, ask its own fixed question, write up the
// order with its own prices and total, place the order the customer said
// yes to, or take it back. The AI's words are never sent here. Pure.

export type OrderAnswer = Extract<AssistantAnswer, { kind: "order_summary" | "order_confirmed" | "order_withdrawn" }>;

export type OrderStep =
  | { kind: "handover"; reason: "order" | "order_unclear" }
  | { kind: "ask"; text: string }
  | { kind: "propose"; order: PricedOrder; text: string }
  | { kind: "place" }
  | { kind: "withdraw"; text: string };

export type OrderingForStep = {
  takesOrders: boolean;
  closedNow: string | null;
  menu: MenuChoice[];
  options: OrderingOptions;
};

export function planOrderStep(answer: OrderAnswer, ordering: OrderingForStep, kind: CompanyKind): OrderStep {
  // A person's account, or a restaurant that takes no orders here: a person does.
  if (kind !== "business" || !ordering.takesOrders) {
    return { kind: "handover", reason: "order" };
  }
  if (answer.kind === "order_confirmed") {
    return { kind: "place" };
  }
  if (answer.kind === "order_withdrawn") {
    return { kind: "withdraw", text: ORDER_WITHDRAWN_TEXT };
  }
  if (ordering.closedNow) {
    return { kind: "ask", text: orderClosedText(ordering.closedNow) };
  }
  const priced = priceOrder(answer.order, ordering.menu, ordering.options);
  if ("gap" in priced) {
    return priced.gap === "unknown_item" ? { kind: "handover", reason: "order_unclear" } : { kind: "ask", text: orderQuestion(priced.gap, ordering.options) };
  }
  return { kind: "propose", order: priced, text: orderSummaryText(priced) };
}
