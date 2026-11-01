import "server-only";
import { randomUUID } from "node:crypto";
import { recordReplyDelivery } from "@/db/conversation-writes";
import { saveHandover } from "@/db/assistant-handover";
import type { AssistantTurn, ConversationForAssistant } from "@/db/assistant-runs";
import { withAiLabel } from "@/lib/assistant/ai-label";
import { HANDOVER_REASON_TEXT, type HandoverReason } from "@/lib/assistant/reasons";
import type { ChatDeliveryOptions } from "@/lib/chat-delivery";
import { CHANNEL_LABELS } from "@/lib/conversations";
import { encryptText } from "@/lib/encryption";
import { conversationMessageContext } from "@/lib/encryption-contexts";
import type { CompanyKind } from "@/lib/restaurant-setup";
import { newTicketSchema } from "@/lib/validation/tickets";
import { notifyAssignee } from "./assignment-notifications";
import { alertOwners, type AlertOptions } from "./owner-alerts";
import { sendToCustomer } from "./chat-send";

// Hands one conversation to a person (step 49): the restaurant's holding
// reply goes to the customer (never the AI's own text; with the AI label
// when it is the first automated message), a request is opened and routed,
// whoever routing picks is emailed, and the owners are alerted. Once per
// request: while it is open the assistant stays quiet.

export type HandoverInput = {
  reason: HandoverReason;
  conversation: ConversationForAssistant;
  // A business, or one person (step 50): how the AI label reads.
  kind: CompanyKind;
  restaurantName: string;
  holdingReply: string;
  // What the AI wrote for the request, when it asked for a person itself.
  request: { subject: string; summary: string; categoryId: string | null } | null;
  // False when the AI's reply just failed to send: the channel can't take a holding reply either.
  sendHoldingReply: boolean;
};

export type HandoverOptions = { delivery?: ChatDeliveryOptions; alerts?: AlertOptions };

export async function handOver(turn: AssistantTurn, input: HandoverInput, options: HandoverOptions = {}): Promise<"handed-over" | "skipped"> {
  const holdingText = withAiLabel(input.holdingReply, input.restaurantName, input.conversation.isFirstAutomatedMessage, input.kind);
  const holdingId = randomUUID();
  const saved = await saveHandover(turn, {
    reason: input.reason,
    holdingReply: input.sendHoldingReply
      ? { messageId: holdingId, bodyEncrypted: encryptText(holdingText, conversationMessageContext(turn.companyId, holdingId)) }
      : null,
    request: requestFields(input),
  });
  if (saved === "skipped") {
    return "skipped";
  }
  let holdingReplySent = false;
  if (saved.target) {
    const delivery = await sendToCustomer(turn.companyId, saved.target, { id: holdingId, text: holdingText }, options.delivery);
    await recordReplyDelivery(turn.companyId, holdingId, delivery);
    holdingReplySent = delivery.status === "sent";
  }
  if (saved.assignedToUserId) {
    await notifyAssignee({ companyId: turn.companyId, ticketId: saved.ticketId, assigneeUserId: saved.assignedToUserId, assignedByUserId: null });
  }
  await alertOwners(
    {
      ...turn,
      channel: input.conversation.channel,
      customerName: input.conversation.contactName,
      reason: input.reason,
      holdingReplySent,
    },
    options.alerts,
  );
  return "handed-over";
}

// The request a person sees: the AI's subject and summary when it wrote
// them, ansa's fixed words otherwise; always the reason. Ticket rules apply
// (lib/validation/ticket-fields.ts): a subject they refuse falls back to the fixed one.
function requestFields(input: HandoverInput) {
  const fallbackSubject = `${CHANNEL_LABELS[input.conversation.channel]} conversation needs you`;
  const description = [HANDOVER_REASON_TEXT[input.reason], input.request?.summary ?? ""].filter(Boolean).join("\n\n");
  const fields = {
    subject: input.request?.subject || fallbackSubject,
    description,
    channel: "chat" as const,
    category: null,
    customerName: input.conversation.contactName,
    customerEmail: null,
    customerPhone: null,
  };
  const parsed = newTicketSchema.safeParse(fields);
  const valid = parsed.success ? parsed.data : newTicketSchema.parse({ ...fields, subject: fallbackSubject, customerName: null });
  return { subject: valid.subject, description: valid.description, categoryId: input.request?.categoryId ?? null, customerName: valid.customerName };
}
