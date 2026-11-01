import "server-only";
import { z } from "zod";
import { withAiLabel } from "@/lib/assistant/ai-label";
import { HANDOVER_REASON_TEXT } from "@/lib/assistant/reasons";
import { planOrderStep } from "@/lib/order-steps";
import type { ModelAsker } from "@/lib/model-request";
import { canManageRestaurant } from "@/lib/restaurant-permissions";
import type { SessionContext } from "@/lib/session";
import { assistantTestSchema } from "@/lib/validation/assistant";
import { assistantAskerFor } from "./assistant-engine";
import { gatherAssistantInputs } from "./assistant-inputs";
import { decide } from "./assistant-reply";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// "Test your assistant" (Settings → Assistant, step 49): what the assistant
// would answer a customer's first message, with the same data, AI engine
// and checks as a real one. Nothing is saved, sent or alerted. Owners only
// (each test is a paid AI call); assistant-tests limit.

export type AssistantTestResult =
  | { ok: true; outcome: "reply"; text: string }
  | { ok: true; outcome: "handover"; holdingReply: string; why: string }
  | { ok: true; outcome: "no_reply" }
  | { ok: false; errors: { message?: string; fieldErrors?: Record<string, string[] | undefined> } };

// `asker` is only passed by the checks (a fake model).
export async function testAssistantForSession(session: SessionContext, input: unknown, asker?: ModelAsker | null): Promise<AssistantTestResult> {
  if (!canManageRestaurant(session.role)) {
    return { ok: false, errors: { message: "Only owners can test the assistant." } };
  }
  const parsed = assistantTestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  if (await isOverRateLimit("assistant-tests", session.userId, RATE_LIMITS.assistantTestsPerUser)) {
    return { ok: false, errors: { message: "Too many tests. Try again in a few minutes." } };
  }
  const inputs = await gatherAssistantInputs(session.companyId, [{ from: "customer", text: parsed.data.text }]);
  const decided = await decide(asker === undefined ? await assistantAskerFor(session.companyId) : asker, inputs);
  if (decided.kind === "reply") {
    return { ok: true, outcome: "reply", text: withAiLabel(decided.text, inputs.restaurantName, true, inputs.kind) };
  }
  if (decided.kind === "no_reply") {
    return { ok: true, outcome: "no_reply" };
  }
  // An order (step 52): what ansa itself would send. A test has no order
  // waiting for a yes, so a "yes" hands over, as it would in a chat.
  const reason = decided.kind === "order" ? orderTestStep(decided.answer, inputs) : decided.reason;
  if (typeof reason !== "string") {
    return { ok: true, outcome: "reply", text: withAiLabel(reason.text, inputs.restaurantName, true, inputs.kind) };
  }
  return { ok: true, outcome: "handover", holdingReply: withAiLabel(inputs.holdingReply, inputs.restaurantName, true, inputs.kind), why: HANDOVER_REASON_TEXT[reason] };
}

function orderTestStep(answer: Parameters<typeof planOrderStep>[0], inputs: Awaited<ReturnType<typeof gatherAssistantInputs>>) {
  const step = planOrderStep(answer, inputs.ordering, inputs.kind);
  if (step.kind === "handover") {
    return step.reason;
  }
  return step.kind === "place" ? "order_unclear" : { text: step.text };
}
