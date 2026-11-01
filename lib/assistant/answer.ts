import { z } from "zod";
import { cutToLength } from "@/lib/cofounder/fact-proposals";
import { ORDER_ADDRESS_MAX_LENGTH, ORDER_LINES_MAX, ORDER_NOTES_MAX_LENGTH, ORDER_TIME_MAX_LENGTH, type OrderRequest } from "@/lib/orders";
import { toPlainSingleLine } from "@/lib/plain-text";
import { AI_HANDOVER_REASONS, type AiHandoverReason } from "./reasons";

// The restaurant assistant's one structured answer (step 49): a reply for
// the customer, a person needed (and why, with a line for the request), or
// nothing to say; since step 52 also an order to write up (by menu label:
// ansa prices it and writes the summary), the customer's yes to ansa's
// summary, or their no. The JSON schema Claude must follow, and the strict
// reading of what comes back: anything else is unusable, and the customer
// gets the holding reply instead (never the AI's text).

// The longest reply ansa sends: a chat answer, not a letter. A longer one
// is unusable (cutting it could cut a sentence's meaning).
export const ASSISTANT_REPLY_MAX_LENGTH = 1_500;
const SUBJECT_MAX_LENGTH = 120;
const SUMMARY_MAX_LENGTH = 1_000;

const ACTIONS = ["reply", "needs_person", "no_reply", "order_summary", "order_confirmed", "order_withdrawn"] as const;

export const ASSISTANT_ANSWER_JSON_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ACTIONS },
    reply: { type: "string" },
    handover_reason: { type: "string", enum: ["", ...AI_HANDOVER_REASONS] },
    request_subject: { type: "string" },
    request_summary: { type: "string" },
    category: { type: "string" },
    order: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { label: { type: "string" }, quantity: { type: "integer" } },
            required: ["label", "quantity"],
            additionalProperties: false,
          },
        },
        fulfilment: { type: "string", enum: ["", "delivery", "pickup"] },
        address: { type: "string" },
        time: { type: "string" },
        notes: { type: "string" },
      },
      required: ["items", "fulfilment", "address", "time", "notes"],
      additionalProperties: false,
    },
  },
  required: ["action", "reply", "handover_reason", "request_subject", "request_summary", "category", "order"],
  additionalProperties: false,
} as const;

const orderSchema = z
  .object({
    items: z.array(z.object({ label: z.string().max(20), quantity: z.number().int() }).strict()).max(100),
    fulfilment: z.enum(["", "delivery", "pickup"]),
    address: z.string().max(5_000),
    time: z.string().max(5_000),
    notes: z.string().max(5_000),
  })
  .strict();

const answerSchema = z
  .object({
    action: z.enum(ACTIONS),
    reply: z.string().max(20_000),
    handover_reason: z.enum(["", ...AI_HANDOVER_REASONS]),
    request_subject: z.string().max(5_000),
    request_summary: z.string().max(20_000),
    category: z.string().max(500),
    order: orderSchema,
  })
  .strict();

export type AssistantAnswer =
  | { kind: "reply"; text: string }
  | { kind: "needs_person"; reason: AiHandoverReason; subject: string; summary: string; category: string }
  | { kind: "no_reply" }
  | { kind: "order_summary"; order: OrderRequest }
  | { kind: "order_confirmed" }
  | { kind: "order_withdrawn" };

// The model's text as an answer, or null when it isn't one ansa can use.
export function readAssistantAnswer(outputText: string): AssistantAnswer | null {
  let json: unknown;
  try {
    json = JSON.parse(outputText);
  } catch {
    return null;
  }
  const parsed = answerSchema.safeParse(json);
  if (!parsed.success) {
    return null;
  }
  const answer = parsed.data;
  if (answer.action === "no_reply" || answer.action === "order_confirmed" || answer.action === "order_withdrawn") {
    return { kind: answer.action };
  }
  if (answer.action === "order_summary") {
    return answer.order.items.length > ORDER_LINES_MAX ? null : { kind: "order_summary", order: cleanOrder(answer.order) };
  }
  if (answer.action === "needs_person") {
    return {
      kind: "needs_person",
      reason: answer.handover_reason || "unsure",
      subject: cutToLength(toPlainSingleLine(answer.request_subject), SUBJECT_MAX_LENGTH).trim(),
      summary: cleanReplyText(answer.request_summary).slice(0, SUMMARY_MAX_LENGTH),
      category: toPlainSingleLine(answer.category).trim(),
    };
  }
  const text = cleanReplyText(answer.reply);
  if (text === "" || text.length > ASSISTANT_REPLY_MAX_LENGTH) {
    return null;
  }
  return { kind: "reply", text };
}

// The order's free texts as one plain line each, cut to what an order keeps.
function cleanOrder(order: z.infer<typeof orderSchema>): OrderRequest {
  const line = (text: string, max: number) => cutToLength(toPlainSingleLine(text), max).trim();
  return {
    items: order.items.map((item) => ({ label: item.label.trim(), quantity: item.quantity })),
    fulfilment: order.fulfilment,
    address: line(order.address, ORDER_ADDRESS_MAX_LENGTH),
    time: line(order.time, ORDER_TIME_MAX_LENGTH),
    notes: line(order.notes, ORDER_NOTES_MAX_LENGTH),
  };
}

// A chat text: line breaks kept (at most one empty line in a row), every
// other control or invisible format character taken out but the zero-width
// joiner (emoji sequences), trimmed.
export function cleanReplyText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\P{C}\n\u200d]/gu, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
