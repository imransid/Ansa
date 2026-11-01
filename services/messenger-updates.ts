import "server-only";
import { randomUUID } from "node:crypto";
import { getMessengerName } from "@/adapters/messenger";
import type { AssistantTurn } from "@/db/assistant-runs";
import { insertCustomerChatMessage } from "@/db/conversation-writes";
import { contactNeedsName, fillContactNameOnce } from "@/db/messenger-contacts";
import { findMessengerPage, findStandInFacebookPage } from "@/db/messenger-links";
import { insertBusinessAccountMessage } from "@/db/telegram-messages";
import { encryptText } from "@/lib/encryption";
import { conversationMessageContext } from "@/lib/encryption-contexts";
import { describeMessengerMessage, messengerContact } from "@/lib/messenger";
import type { PlatformMode } from "@/lib/social-mode";
import { standInsAllowed } from "@/lib/social-mode";
import type { SocialFetch } from "@/lib/social-types";
import type { MessengerMessaging } from "@/lib/validation/messenger";
import { prepareConnectionForUse } from "./social-tokens";

// Messenger's messages (step 53), after the webhook's checks: the company
// comes ONLY from the Page id Meta signed, and only when exactly one
// company has that Page connected (db/messenger-links.ts). A customer's
// message joins their conversation (saved once per Meta message id) and
// the assistant answers it; a message the Page itself sent (an echo) is
// saved as the Page's own, unless ansa's app sent it (already saved).
// Text and the kind of attachment only, never downloaded. Never logged.

export type AnswerMessengerCustomer = (turn: AssistantTurn, page: { connectionId: string; psid: string }) => void;

export async function handleMessengerEvent(pageId: string, event: MessengerMessaging, ownAppId: string | null, answer: AnswerMessengerCustomer): Promise<void> {
  const message = event.message;
  if (!message) {
    return;
  }
  const page = await findMessengerPage(pageId);
  if (!page) {
    console.warn("Messenger message ignored: its Page isn't connected to exactly one ansa company");
    return;
  }
  const text = describeMessengerMessage(message);
  if (text === null) {
    return;
  }
  const messageId = randomUUID();
  const saved = { messageId, bodyEncrypted: encryptText(text, conversationMessageContext(page.companyId, messageId)), channelMessageId: message.mid };
  if (message.is_echo) {
    if (ownAppId === null || String(message.app_id ?? "") !== ownAppId) {
      await insertBusinessAccountMessage(page.companyId, messengerContact(pageId, event.recipient.id, null), saved);
    }
    return;
  }
  if (event.recipient.id !== pageId) {
    return;
  }
  const turn = await insertCustomerChatMessage(page.companyId, messengerContact(pageId, event.sender.id, null), saved);
  if (turn) {
    answer(turn, { connectionId: page.connectionId, psid: event.sender.id });
  }
}

// The customer's name from Meta, once, when their contact has none (best
// effort: without it the Inbox shows "Messenger customer").
export async function fillMessengerName(
  turn: AssistantTurn,
  page: { connectionId: string; psid: string },
  options: { mode: PlatformMode; fetchFn?: SocialFetch },
): Promise<void> {
  try {
    if (options.mode.kind !== "real" || !(await contactNeedsName(turn.companyId, turn.conversationId))) {
      return;
    }
    const connection = await prepareConnectionForUse(turn.companyId, page.connectionId, { fetchFn: options.fetchFn });
    if (connection.kind !== "ready") {
      return;
    }
    const context = { fetchFn: options.fetchFn ?? fetch, appSecret: options.mode.credentials.clientSecret };
    const name = await getMessengerName(context, { psid: page.psid, pageToken: connection.target.accessToken });
    if (name) {
      await fillContactNameOnce(turn.companyId, turn.conversationId, name.slice(0, 200));
    }
  } catch (error) {
    console.warn(`Messenger name not read: ${error instanceof Error ? error.constructor.name : "unknown"}`);
  }
}

// A customer's message to the company's stand-in Facebook Page (pnpm
// simulate:messenger, development only), handled like a real one.
export async function receiveStandInMessengerMessage(
  companyId: string,
  customerName: string,
  text: string,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): Promise<AssistantTurn | "no-stand-in" | "not-allowed" | null> {
  if (!standInsAllowed(nodeEnv)) {
    return "not-allowed";
  }
  const page = await findStandInFacebookPage(companyId);
  if (!page) {
    return "no-stand-in";
  }
  const psid = customerName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "customer";
  const messageId = randomUUID();
  return insertCustomerChatMessage(companyId, messengerContact(page.pageId, psid, customerName), {
    messageId,
    bodyEncrypted: encryptText(text, conversationMessageContext(companyId, messageId)),
    channelMessageId: `stand-in-${messageId}`,
  });
}
