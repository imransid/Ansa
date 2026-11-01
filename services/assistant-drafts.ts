import "server-only";
import { claimDraftForSending, discardDraft } from "@/db/assistant-drafts";
import { recordReplyDelivery } from "@/db/conversation-writes";
import type { ChatDeliveryOptions } from "@/lib/chat-delivery";
import { decryptForDisplay } from "@/lib/encryption";
import { conversationMessageContext } from "@/lib/encryption-contexts";
import type { FormResult } from "@/lib/form-result";
import type { SessionContext } from "@/lib/session";
import { draftInputSchema } from "@/lib/validation/conversations";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";
import { sendToCustomer } from "./chat-send";

// The assistant's waiting replies ("Ask me first", step 49) on a
// conversation's page: Send it as written, or Discard it. Edit is a
// person's own reply that replaces it (services/conversations.ts). Anyone
// in the company, as they work conversations; inbox-changes limit.

const REFUSALS = {
  "not-found": "This conversation isn't there any more. Reload the page.",
  "not-chat": "Calls and emails can't be answered from ansa yet.",
  "not-connected": "Telegram isn't connected. Connect it in Settings → Connections.",
  "cannot-reply": "ansa isn't allowed to reply on your Telegram account. Allow it in Telegram Business → Chatbots.",
  "window-closed": "Telegram lets ansa reply only within 24 hours of the customer's last message. Answer them in your Telegram app instead.",
  "not-waiting": "This reply was already sent or discarded. Reload the page.",
  "not-allowed": "You can no longer work this company's conversations.",
} as const;

// Sends one waiting reply as the assistant wrote it. `delivery` is only passed by the checks.
export async function sendDraftForSession(session: SessionContext, input: unknown, delivery: ChatDeliveryOptions = {}): Promise<FormResult> {
  const parsed = draftInputSchema.safeParse(input);
  if (!parsed.success) {
    return refused("not-found");
  }
  if (await isOverRateLimit("inbox-changes", session.userId, RATE_LIMITS.inboxChangesPerUser)) {
    return { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };
  }
  const claimed = await claimDraftForSending(session.companyId, session.userId, parsed.data);
  if (typeof claimed === "string") {
    return refused(claimed);
  }
  const text = decryptForDisplay(claimed.bodyEncrypted, conversationMessageContext(session.companyId, parsed.data.messageId)).text;
  const result = text === null ? ({ status: "failed", error: "not_connected" } as const) : await sendToCustomer(session.companyId, claimed.target, { id: parsed.data.messageId, text }, delivery);
  await recordReplyDelivery(session.companyId, parsed.data.messageId, result);
  return { ok: true };
}

// Discards one waiting reply: the customer never gets it.
export async function discardDraftForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = draftInputSchema.safeParse(input);
  if (!parsed.success) {
    return refused("not-found");
  }
  if (await isOverRateLimit("inbox-changes", session.userId, RATE_LIMITS.inboxChangesPerUser)) {
    return { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };
  }
  const outcome = await discardDraft(session.companyId, session.userId, parsed.data);
  return outcome === "saved" ? { ok: true } : refused(outcome);
}

function refused(reason: keyof typeof REFUSALS): FormResult {
  return { ok: false, errors: { message: REFUSALS[reason] } };
}
