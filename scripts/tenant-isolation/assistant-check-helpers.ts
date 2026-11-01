// Shared by the assistant checks (step 49): a restaurant with a menu, a
// fake model that answers what a check tells it (and records what it was
// asked), and a customer's message through the stand-in chat. Nothing here
// asks a real AI.

import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { saveAssistantSettings, saveOrdersSection } from "@/db/assistant-settings";
import { db } from "@/db/client";
import { addMenuItems } from "@/db/menu";
import { messages, tickets } from "@/db/schema";
import { decryptForDisplay } from "@/lib/encryption";
import { conversationMessageContext } from "@/lib/encryption-contexts";
import type { ModelAsker, ModelRequest } from "@/lib/model-request";
import type { ReplyMode } from "@/lib/restaurant-setup";
import { runAssistantReply } from "@/services/assistant-reply";
import { receiveStandInMessage } from "@/services/conversations";
import type { TestUser } from "./helpers";

export const HOLDING_REPLY = "Thanks! Our team will get back to you shortly.";

// A restaurant ready to answer: euros, two dishes, a delivery fee in its note.
export async function setUpRestaurant(owner: TestUser, replyMode: ReplyMode = "automatic"): Promise<void> {
  const orders = { takesOrders: true, delivery: true, deliveryNote: "Delivery costs €2.50 within 3 km.", deliveryFeeCents: 250, pickup: true, paymentNote: "Cash or card on delivery.", currency: "EUR" };
  assert.equal(await saveOrdersSection(owner.companyId, owner.id, orders, null), "saved");
  const assistant = { status: "on" as const, replyMode, instructions: "Our website is https://luigis.example/menu.", holdingReply: HOLDING_REPLY, alertByEmail: true };
  assert.equal(await saveAssistantSettings(owner.companyId, owner.id, assistant), "saved");
  const dishes = [
    { category: "Pizza", name: "Margherita", description: "Tomato and mozzarella", priceCents: 950 },
    { category: "Dessert", name: "Tiramisù", description: "", priceCents: 600 },
  ];
  assert.equal(await addMenuItems(owner.companyId, owner.id, dishes), "saved");
}

// The JSON the assistant's schema asks for, with these fields changed.
export function answer(fields: {
  action?: string;
  reply?: string;
  handover_reason?: string;
  request_subject?: string;
  request_summary?: string;
  category?: string;
  order?: { items: { label: string; quantity: number }[]; fulfilment: string; address: string; time: string; notes: string };
}): string {
  const noOrder = { items: [], fulfilment: "", address: "", time: "", notes: "" };
  return JSON.stringify({ action: "reply", reply: "", handover_reason: "", request_subject: "", request_summary: "", category: "", order: noOrder, ...fields });
}

// A fake model answering `output` each time (or a failure), recording each request.
export function fakeModel(output: string | "error") {
  const requests: ModelRequest[] = [];
  const asker: ModelAsker = async (request) => {
    requests.push(request);
    return output === "error" ? { kind: "error", errorName: "APIConnectionTimeoutError" } : { kind: "ok", outputText: output, usage: { inputTokens: 1, outputTokens: 1 } };
  };
  return { asker, requests };
}

// A customer's message in the stand-in chat, then the assistant's run on it.
export async function customerWrites(owner: TestUser, customer: string, text: string, asker: ModelAsker | null) {
  const turn = await receiveStandInMessage(owner.companyId, customer, text);
  assert.ok(turn);
  const outcome = await runAssistantReply(turn, { asker, settleMs: 0 });
  return { turn, outcome };
}

// What went to the customer (or waits): the assistant's messages, oldest first.
export async function assistantMessages(owner: TestUser, conversationId: string) {
  const rows = await db
    .select({ id: messages.id, status: messages.sendStatus, body: messages.bodyEncrypted })
    .from(messages)
    .where(and(eq(messages.companyId, owner.companyId), eq(messages.conversationId, conversationId), eq(messages.author, "assistant")))
    .orderBy(messages.createdAt);
  return rows.map((row) => ({ id: row.id, status: row.status, text: decryptForDisplay(row.body, conversationMessageContext(owner.companyId, row.id)).text }));
}

export async function openRequests(owner: TestUser, conversationId: string) {
  return db
    .select({ subject: tickets.subject, description: tickets.description, channel: tickets.channel })
    .from(tickets)
    .where(and(eq(tickets.companyId, owner.companyId), eq(tickets.conversationId, conversationId), eq(tickets.status, "open")));
}

// For the scheduled jobs' checks that look at other work: no assistant catch-up.
export async function noCatchUp() {
  return { answered: 0, alreadyAnswered: 0 };
}
