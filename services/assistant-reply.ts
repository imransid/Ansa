import "server-only";
import { randomUUID } from "node:crypto";
import {
  markAssistantHandled,
  readAssistantGate,
  saveAssistantReply,
  scheduleAssistantCheck,
  type AssistantTurn,
  type ConversationForAssistant,
} from "@/db/assistant-runs";
import { recordReplyDelivery } from "@/db/conversation-writes";
import { saveOrderProposal, type ProposalToSave } from "@/db/order-proposals";
import { withAiLabel } from "@/lib/assistant/ai-label";
import { decideCover } from "@/lib/assistant/availability";
import { readAssistantAnswer, type AssistantAnswer } from "@/lib/assistant/answer";
import { buildAssistantRequest } from "@/lib/assistant/prompt";
import type { HandoverReason } from "@/lib/assistant/reasons";
import { checkAssistantReply } from "@/lib/assistant/reply-checks";
import { encryptText } from "@/lib/encryption";
import type { OrderAnswer } from "@/lib/order-steps";
import { conversationMessageContext } from "@/lib/encryption-contexts";
import type { ModelAsker } from "@/lib/model-request";
import { assistantAskerFor } from "./assistant-engine";
import { readAvailability } from "./availability";
import { handOver, type HandoverOptions } from "./assistant-handover";
import { conversationForAssistant, gatherAssistantInputs, type AssistantInputs } from "./assistant-inputs";
import { runOrderStep } from "./assistant-order";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";
import { sendToCustomer } from "./chat-send";

// The restaurant assistant answers one customer message on its own (step
// 49), after it was saved and the channel had its answer. In order: may it
// answer at all (paused, taken over, a request open, a newer message, done
// already: then nothing, holding reply included); the customer's and the
// restaurant's hourly limits; one answer from the AI (services/
// assistant-engine.ts); ansa's checks (lib/assistant/reply-checks.ts). A
// reply that passes goes out (Automatic) or waits (Ask me first); anything
// else hands over (services/assistant-handover.ts). The AI's own text is
// never sent unless it passed. LOGGING RULE: never a message or the AI's
// answer; fixed lines and class names only.

// "waiting": you may still answer yourself; the scheduled runs look again
// once your minutes are up (step 51).
export type AssistantOutcome = "replied" | "drafted" | "no-reply" | "handed-over" | "quiet" | "waiting";

// Only the checks pass these: a fake model (or null for "none set up"), no
// wait, a NODE_ENV, and fake channels. coverAfterNoReply: the scheduled run
// for a message you didn't answer in time (services/assistant-due.ts): ansa
// answers now whatever your away settings say.
export type AssistantRunOptions = HandoverOptions & { asker?: ModelAsker | null; settleMs?: number; now?: Date; coverAfterNoReply?: boolean };

// Customers often send a few messages in a row: wait a moment, so one
// answer covers them all (the run for an older message then stays quiet).
const SETTLE_MS = 1_500;

export async function runAssistantReply(turn: AssistantTurn, options: AssistantRunOptions = {}): Promise<AssistantOutcome> {
  try {
    await new Promise((resolve) => setTimeout(resolve, options.settleMs ?? SETTLE_MS));
    const { gate, conversation } = await readAssistantGate(turn);
    if (gate !== "may" || !conversation) {
      return "quiet";
    }
    // Only while you're away, when you said so (step 51).
    if (!options.coverAfterNoReply) {
      const cover = decideCover(await readAvailability(turn.companyId), options.now ?? new Date());
      if (cover.kind === "leave") {
        return "quiet";
      }
      if (cover.kind === "wait") {
        await scheduleAssistantCheck(turn, cover.minutes);
        return "waiting";
      }
    }
    if (await isOverRateLimit("assistant-customer", turn.conversationId, RATE_LIMITS.assistantRepliesPerCustomer)) {
      await markAssistantHandled(turn);
      return "quiet";
    }
    const inputs = await gatherAssistantInputs(turn.companyId, await conversationForAssistant(turn.companyId, turn.conversationId), options.now, turn.conversationId);
    // Someone you marked important always comes to you: no AI answer at all.
    if (conversation.important) {
      return handOverFor(turn, conversation, inputs, "important_person", null, options);
    }
    if (await isOverRateLimit("assistant-replies", turn.companyId, RATE_LIMITS.assistantRepliesPerCompany)) {
      return handOverFor(turn, conversation, inputs, "reply_limit", null, options);
    }
    const asker = options.asker === undefined ? await assistantAskerFor(turn.companyId) : options.asker;
    const decided = await decide(asker, inputs);
    if (decided.kind === "no_reply") {
      await markAssistantHandled(turn);
      return "no-reply";
    }
    if (decided.kind === "handover") {
      return handOverFor(turn, conversation, inputs, decided.reason, decided.answer, options);
    }
    // An order (step 52): ansa writes and sends its own texts (services/assistant-order.ts).
    if (decided.kind === "order") {
      return runOrderStep(decided.answer, {
        turn,
        conversation,
        inputs,
        options,
        send: (text, proposal) => sendOrDraft(turn, conversation, inputs, text, options, proposal),
        handOver: (reason) => handOverFor(turn, conversation, inputs, reason, null, options),
      });
    }
    return sendOrDraft(turn, conversation, inputs, decided.text, options);
  } catch (error) {
    console.error(`Assistant reply failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    return "quiet";
  }
}

type Decision =
  | { kind: "reply"; text: string }
  | { kind: "no_reply" }
  | { kind: "handover"; reason: HandoverReason; answer: AssistantAnswer | null }
  | { kind: "order"; answer: OrderAnswer };

// What to do with the AI's answer, ansa's checks included.
export async function decide(asker: ModelAsker | null, inputs: AssistantInputs): Promise<Decision> {
  if (!asker) {
    return { kind: "handover", reason: "model_unavailable", answer: null };
  }
  const result = await asker(buildAssistantRequest(inputs.context));
  if (result.kind !== "ok") {
    if (result.kind === "error") {
      console.error(`Claude call failed: ${result.errorName}`);
    }
    return { kind: "handover", reason: "model_failed", answer: null };
  }
  const answer = readAssistantAnswer(result.outputText);
  if (!answer) {
    return { kind: "handover", reason: "unusable_answer", answer: null };
  }
  if (answer.kind === "needs_person") {
    return { kind: "handover", reason: answer.reason, answer };
  }
  if (answer.kind === "no_reply") {
    return answer;
  }
  if (answer.kind !== "reply") {
    return { kind: "order", answer };
  }
  const check = checkAssistantReply(answer.text, inputs.checkData);
  return check.ok ? { kind: "reply", text: answer.text } : { kind: "handover", reason: check.reason, answer: null };
}

// `proposal`: the order ansa's summary (the reply) describes, saved with it (step 52).
async function sendOrDraft(
  turn: AssistantTurn,
  conversation: ConversationForAssistant,
  inputs: AssistantInputs,
  reply: string,
  options: AssistantRunOptions,
  proposal?: ProposalToSave,
): Promise<AssistantOutcome> {
  const text = withAiLabel(reply, inputs.restaurantName, conversation.isFirstAutomatedMessage, inputs.kind);
  const messageId = randomUUID();
  const waitForPerson = inputs.replyMode === "ask_first";
  const message = { messageId, bodyEncrypted: encryptText(text, conversationMessageContext(turn.companyId, messageId)), waitForPerson };
  const saved = proposal ? await saveOrderProposal(turn, message, proposal) : await saveAssistantReply(turn, message);
  if (saved === "draft") {
    return "drafted";
  }
  if (typeof saved === "string") {
    return "quiet";
  }
  const delivery = await sendToCustomer(turn.companyId, saved, { id: messageId, text }, options.delivery);
  await recordReplyDelivery(turn.companyId, messageId, delivery);
  if (delivery.status === "failed") {
    // The customer got nothing: a person is asked (no holding reply, the channel just refused one).
    await handOverFor(turn, conversation, inputs, "send_failed", null, options, false);
  }
  return "replied";
}

function handOverFor(
  turn: AssistantTurn,
  conversation: ConversationForAssistant,
  inputs: AssistantInputs,
  reason: HandoverReason,
  answer: AssistantAnswer | null,
  options: AssistantRunOptions,
  sendHoldingReply = true,
): Promise<AssistantOutcome> {
  const request =
    answer?.kind === "needs_person"
      ? { subject: answer.subject, summary: answer.summary, categoryId: inputs.categories.find((category) => category.name === answer.category)?.id ?? null }
      : null;
  return handOver(
    turn,
    { reason, conversation, kind: inputs.kind, restaurantName: inputs.restaurantName, holdingReply: inputs.holdingReply, request, sendHoldingReply },
    options,
  ).then(() => "handed-over");
}
