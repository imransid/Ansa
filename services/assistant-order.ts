import "server-only";
import { randomUUID } from "node:crypto";
import type { AssistantTurn, ConversationForAssistant } from "@/db/assistant-runs";
import { recordReplyDelivery } from "@/db/conversation-writes";
import { placeProposedOrder, withdrawProposal, type ProposalToSave } from "@/db/order-proposals";
import type { HandoverReason } from "@/lib/assistant/reasons";
import type { ChatTarget } from "@/lib/chat-delivery";
import { encryptText } from "@/lib/encryption";
import { conversationMessageContext, orderFieldContext } from "@/lib/encryption-contexts";
import { orderPlacedText } from "@/lib/orders";
import { planOrderStep, type OrderAnswer } from "@/lib/order-steps";
import type { AssistantInputs } from "./assistant-inputs";
import type { AssistantOutcome, AssistantRunOptions } from "./assistant-reply";
import { alertOwnersOfOrder } from "./order-alerts";
import { sendToCustomer } from "./chat-send";

// The assistant's order answers in one conversation (step 52), as
// lib/order-steps.ts plans them: ansa's own question or summary goes out
// like a reply (waiting in "Ask me first"), the customer's yes places the
// order (a number, ansa's confirmation sent at once, the owners alerted),
// their no takes it back. Anything ansa can't write up hands over.

// How the reply run sends a text (and saves an order with it) and hands
// over: services/assistant-reply.ts passes its own, so both paths are one.
export type OrderRunTools = {
  turn: AssistantTurn;
  conversation: ConversationForAssistant;
  inputs: AssistantInputs;
  options: AssistantRunOptions;
  send: (text: string, proposal?: ProposalToSave) => Promise<AssistantOutcome>;
  handOver: (reason: HandoverReason) => Promise<AssistantOutcome>;
};

export async function runOrderStep(answer: OrderAnswer, tools: OrderRunTools): Promise<AssistantOutcome> {
  const step = planOrderStep(answer, tools.inputs.ordering, tools.inputs.kind);
  if (step.kind === "handover") {
    return tools.handOver(step.reason);
  }
  if (step.kind === "ask") {
    return tools.send(step.text);
  }
  if (step.kind === "propose") {
    const orderId = randomUUID();
    const { companyId } = tools.turn;
    return tools.send(step.text, {
      orderId,
      order: step.order,
      addressEncrypted: step.order.fulfilment === "delivery" ? encryptText(step.order.address, orderFieldContext(companyId, orderId, "address")) : null,
      notesEncrypted: step.order.notes ? encryptText(step.order.notes, orderFieldContext(companyId, orderId, "notes")) : null,
    });
  }
  if (step.kind === "withdraw") {
    const messageId = randomUUID();
    const saved = await withdrawProposal(tools.turn, { messageId, bodyEncrypted: encryptText(step.text, conversationMessageContext(tools.turn.companyId, messageId)) });
    return typeof saved === "string" ? "quiet" : deliver(tools, saved, messageId, step.text);
  }
  return placeOrder(tools);
}

// The customer's yes: placed with the next number, ansa's confirmation
// sent at once (a fixed text never waits), the owners alerted.
async function placeOrder(tools: OrderRunTools): Promise<AssistantOutcome> {
  const { turn } = tools;
  const messageId = randomUUID();
  const placed = await placeProposedOrder(turn, {
    messageId,
    encryptFor: (orderNumber) => encryptText(orderPlacedText(orderNumber), conversationMessageContext(turn.companyId, messageId)),
  });
  if (placed === "no-proposal") {
    return tools.handOver("order_unclear");
  }
  if (typeof placed === "string") {
    return "quiet";
  }
  const outcome = await deliver(tools, placed.target, messageId, orderPlacedText(placed.orderNumber));
  await alertOwnersOfOrder(
    {
      companyId: turn.companyId,
      conversationId: turn.conversationId,
      orderId: placed.orderId,
      orderNumber: placed.orderNumber,
      totalCents: placed.totalCents,
      currency: placed.currency,
      channel: tools.conversation.channel,
      customerName: tools.conversation.contactName,
    },
    tools.options.alerts,
  );
  return outcome;
}

async function deliver(tools: OrderRunTools, target: ChatTarget, messageId: string, text: string): Promise<AssistantOutcome> {
  const delivery = await sendToCustomer(tools.turn.companyId, target, { id: messageId, text }, tools.options.delivery);
  await recordReplyDelivery(tools.turn.companyId, messageId, delivery);
  return "replied";
}
