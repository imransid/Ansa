// Checks for step 52, every one with a fake model: ansa writes up an order
// itself (its own prices, fee and total, never the AI's), places it only
// when the customer says yes to the summary they saw, numbers orders under
// the company lock, and the Orders page moves one on with a short message
// to the customer. Another company finds none of it.

import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { orderItems, orders } from "@/db/schema";
import { buildAssistantPrompt } from "@/lib/assistant/prompt";
import { checkAssistantReply } from "@/lib/assistant/reply-checks";
import { orderSummaryText, priceOrder, type MenuChoice, type OrderingOptions } from "@/lib/orders";
import { planOrderStep } from "@/lib/order-steps";
import { gatherAssistantInputs } from "@/services/assistant-inputs";
import { changeOrderStatusForSession, countNewOrdersForSession, getOrdersPageForSession } from "@/services/orders";
import { answer, assistantMessages, customerWrites, fakeModel, openRequests, setUpRestaurant } from "./assistant-check-helpers";
import { addTeammate, check, sessionFor, signUpTestOwner, type TestUser } from "./helpers";

const MENU: MenuChoice[] = [
  { label: "M1", name: "Margherita", priceCents: 950 },
  { label: "M2", name: "Tiramisù", priceCents: 600 },
];
const OPTIONS: OrderingOptions = { delivery: true, pickup: true, deliveryFeeCents: 250, currency: "EUR" };
const NO_ORDER = { items: [], fulfilment: "", address: "", time: "", notes: "" };

function orderAnswer(order: { items: { label: string; quantity: number }[]; fulfilment: string; address: string; time?: string; notes?: string }, reply = "") {
  return answer({ action: "order_summary", reply, order: { time: "", notes: "", ...order } });
}

// A customer of the check restaurant asks for two Margheritas delivered;
// the fake model writes the order up; returns the conversation.
async function orderTwoPizzas(owner: TestUser, customer: string) {
  const model = fakeModel(orderAnswer({ items: [{ label: "M1", quantity: 2 }], fulfilment: "delivery", address: "Lake Road 12", notes: "No basil" }, "Total €5"));
  const { turn, outcome } = await customerWrites(owner, customer, "Two margheritas to Lake Road 12 please", model.asker);
  assert.equal(outcome, "replied");
  return turn.conversationId;
}

async function ordersOf(owner: TestUser, conversationId: string) {
  return db
    .select({ id: orders.id, status: orders.status, number: orders.orderNumber, total: orders.totalCents })
    .from(orders)
    .where(and(eq(orders.companyId, owner.companyId), eq(orders.conversationId, conversationId)));
}

export async function runOrderChecks() {
  await check("orders: ansa prices an order from the menu (lines, the same dish twice in one line, the fee only for delivery, the total) and asks its own question for what is missing; an unknown dish or count is never priced", async () => {
    const priced = priceOrder({ items: [{ label: "m1", quantity: 1 }, { label: "M1", quantity: 1 }, { label: "M2", quantity: 1 }], fulfilment: "delivery", address: "Lake Road 12", time: "", notes: "" }, MENU, OPTIONS);
    assert.ok(!("gap" in priced));
    assert.deepEqual(priced.lines, [
      { name: "Margherita", quantity: 2, unitPriceCents: 950, lineTotalCents: 1900 },
      { name: "Tiramisù", quantity: 1, unitPriceCents: 600, lineTotalCents: 600 },
    ]);
    assert.deepEqual([priced.subtotalCents, priced.deliveryFeeCents, priced.totalCents, priced.time], [2500, 250, 2750, "As soon as possible"]);
    const summary = orderSummaryText(priced);
    for (const line of ["2 × Margherita: €19.00", "Delivery: €2.50", "Total: €27.50", "Delivery to: Lake Road 12", "Reply “yes” to confirm."]) {
      assert.ok(summary.includes(line), line);
    }
    const pickup = priceOrder({ items: [{ label: "M2", quantity: 3 }], fulfilment: "pickup", address: "ignored", time: "20:30", notes: "" }, MENU, OPTIONS);
    assert.ok(!("gap" in pickup) && pickup.totalCents === 1800 && pickup.deliveryFeeCents === 0 && pickup.address === "");
    const gap = (request: Parameters<typeof priceOrder>[0], options = OPTIONS) => {
      const result = priceOrder(request, MENU, options);
      return "gap" in result ? result.gap : "priced";
    };
    assert.equal(gap({ items: [{ label: "M9", quantity: 1 }], fulfilment: "pickup", address: "", time: "", notes: "" }), "unknown_item");
    assert.equal(gap({ items: [{ label: "M1", quantity: 0 }], fulfilment: "pickup", address: "", time: "", notes: "" }), "unknown_item");
    assert.equal(gap({ items: [{ label: "M1", quantity: 51 }], fulfilment: "pickup", address: "", time: "", notes: "" }), "unknown_item");
    assert.equal(gap({ items: [], fulfilment: "pickup", address: "", time: "", notes: "" }), "no_items");
    assert.equal(gap({ items: [{ label: "M1", quantity: 1 }], fulfilment: "", address: "", time: "", notes: "" }), "how");
    assert.equal(gap({ items: [{ label: "M1", quantity: 1 }], fulfilment: "delivery", address: " ", time: "", notes: "" }), "address");
    // Delivery asked of a place that only does pickup.
    assert.equal(gap({ items: [{ label: "M1", quantity: 1 }], fulfilment: "delivery", address: "x", time: "", notes: "" }, { ...OPTIONS, delivery: false }), "how");
  });

  await check("orders: what ansa does with an order answer: a person's account, or a business that takes no orders, hands over; while closed it says so; an unknown dish hands over; a gap gets ansa's question", async () => {
    const summary = { kind: "order_summary" as const, order: { items: [{ label: "M1", quantity: 1 }], fulfilment: "pickup" as const, address: "", time: "", notes: "" } };
    const ordering = { takesOrders: true, closedNow: null, menu: MENU, options: OPTIONS };
    assert.deepEqual(planOrderStep(summary, ordering, "personal"), { kind: "handover", reason: "order" });
    assert.deepEqual(planOrderStep(summary, { ...ordering, takesOrders: false }, "business"), { kind: "handover", reason: "order" });
    assert.deepEqual(planOrderStep(summary, { ...ordering, closedNow: "Opens at 18:00" }, "business"), { kind: "ask", text: "Sorry, we can't take orders right now (opens at 18:00)." });
    assert.deepEqual(planOrderStep({ ...summary, order: { ...summary.order, items: [{ label: "M7", quantity: 1 }] } }, ordering, "business"), { kind: "handover", reason: "order_unclear" });
    assert.equal(planOrderStep({ ...summary, order: { ...summary.order, fulfilment: "" } }, ordering, "business").kind, "ask");
    assert.equal(planOrderStep(summary, ordering, "business").kind, "propose");
    assert.deepEqual(planOrderStep({ kind: "order_confirmed" }, ordering, "business"), { kind: "place" });
  });

  await check("orders: a chat order end to end: ansa sends its own summary and total (never the AI's words), saves it unnumbered, places it with #1 on 'yes', and the Orders page moves it on with a message each time; a second press finds it changed", async () => {
    const owner = await signUpTestOwner("orders-flow");
    await setUpRestaurant(owner);
    const conversationId = await orderTwoPizzas(owner, "Anna");
    const summary = (await assistantMessages(owner, conversationId)).at(-1);
    assert.ok(summary?.text?.includes("Total: €21.50") && summary.text.includes("Delivery: €2.50") && !summary.text.includes("€5"), "ansa's summary, not the AI's");
    assert.deepEqual(
      (await ordersOf(owner, conversationId)).map((order) => [order.status, order.number, order.total]),
      [["proposed", null, 2150]],
    );
    assert.equal((await getOrdersPageForSession(sessionFor(owner))).open.length, 0, "a proposal isn't on the Orders page");

    const yes = await customerWrites(owner, "Anna", "Yes please", fakeModel(answer({ action: "order_confirmed", order: NO_ORDER })).asker);
    assert.equal(yes.outcome, "replied");
    assert.equal((await assistantMessages(owner, conversationId)).at(-1)?.text, "Thank you! Your order #1 is placed. We'll message you as soon as it's accepted.");
    const page = await getOrdersPageForSession(sessionFor(owner));
    assert.equal(page.open.length, 1);
    assert.deepEqual([page.open[0].orderNumber, page.open[0].status, page.open[0].address, page.open[0].notes], [1, "new", "Lake Road 12", "No basil"]);
    assert.equal(await countNewOrdersForSession(sessionFor(owner)), 1);

    const orderId = page.open[0].id;
    const member = await addTeammate(owner, "orders-member", "member");
    assert.deepEqual(await changeOrderStatusForSession(sessionFor(member), { orderId, change: "accept" }), { ok: true });
    assert.deepEqual(await changeOrderStatusForSession(sessionFor(owner), { orderId, change: "ready" }), { ok: true });
    assert.deepEqual(await changeOrderStatusForSession(sessionFor(owner), { orderId, change: "done" }), { ok: true });
    const again = await changeOrderStatusForSession(sessionFor(owner), { orderId, change: "accept" });
    assert.match(again.ok ? "" : (again.errors.message ?? ""), /changed this order meanwhile/);
    const sent = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
    assert.equal(sent[0].status, "done");
    const page2 = await getOrdersPageForSession(sessionFor(owner));
    assert.deepEqual([page2.open.length, page2.finished.length], [0, 1]);
  });

  await check("orders: a 'yes' with no summary seen hands over (order_unclear), a dish ansa can't place hands over, and 'no thanks' takes the proposal back with ansa's own words", async () => {
    const owner = await signUpTestOwner("orders-edges");
    await setUpRestaurant(owner);
    const early = await customerWrites(owner, "Ben", "Yes", fakeModel(answer({ action: "order_confirmed", order: NO_ORDER })).asker);
    assert.equal(early.outcome, "handed-over");
    assert.equal((await openRequests(owner, early.turn.conversationId)).length, 1);

    const unknown = await customerWrites(owner, "Cleo", "One lasagne", fakeModel(orderAnswer({ items: [{ label: "M42", quantity: 1 }], fulfilment: "pickup", address: "" })).asker);
    assert.equal(unknown.outcome, "handed-over");
    assert.equal((await ordersOf(owner, unknown.turn.conversationId)).length, 0);

    const conversationId = await orderTwoPizzas(owner, "Dev");
    const no = await customerWrites(owner, "Dev", "Actually no thanks", fakeModel(answer({ action: "order_withdrawn", order: NO_ORDER })).asker);
    assert.equal(no.outcome, "replied");
    assert.equal((await assistantMessages(owner, conversationId)).at(-1)?.text, "No problem: nothing was ordered.");
    assert.equal((await ordersOf(owner, conversationId)).length, 0);
    assert.equal((await db.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.companyId, owner.companyId))).length, 0);
  });

  await check("orders: two customers saying yes at the same moment get different numbers; another company's member can neither see nor move an order", async () => {
    const owner = await signUpTestOwner("orders-numbers");
    await setUpRestaurant(owner);
    const first = await orderTwoPizzas(owner, "Eva");
    const second = await orderTwoPizzas(owner, "Finn");
    const yes = () => fakeModel(answer({ action: "order_confirmed", order: NO_ORDER })).asker;
    await Promise.all([customerWrites(owner, "Eva", "Yes", yes()), customerWrites(owner, "Finn", "Yes", yes())]);
    const numbers = [...(await ordersOf(owner, first)), ...(await ordersOf(owner, second))].map((order) => order.number).sort();
    assert.deepEqual(numbers, [1, 2]);

    const stranger = await signUpTestOwner("orders-stranger");
    assert.deepEqual(await getOrdersPageForSession(sessionFor(stranger)), { open: [], finished: [] });
    const [order] = await ordersOf(owner, first);
    const refused = await changeOrderStatusForSession(sessionFor(stranger), { orderId: order.id, change: "cancel" });
    assert.equal(refused.ok, false);
    assert.equal((await ordersOf(owner, first))[0].status, "new");
  });

  await check("orders: the assistant reads whether it takes orders, the delivery fee and the order being written up; the fee is an amount its replies may name", async () => {
    const owner = await signUpTestOwner("orders-prompt");
    await setUpRestaurant(owner);
    const conversationId = await orderTwoPizzas(owner, "Gus");
    const inputs = await gatherAssistantInputs(owner.companyId, [{ from: "customer", text: "Is that right?" }], new Date(), conversationId);
    const prompt = buildAssistantPrompt(inputs.context);
    for (const text of ["Orders through this chat: yes", "Delivery fee: €2.50", "<order_in_progress>\n2 × Margherita (M1)\ndelivery\nwhen: As soon as possible\n</order_in_progress>", "<placed_orders>\nNone.\n</placed_orders>"]) {
      assert.ok(prompt.includes(text), text);
    }
    assert.ok(checkAssistantReply("Delivery is €2.50.", inputs.checkData).ok);
  });
}
