import "server-only";
import { writeStandInChatMessage } from "@/adapters/dev-chat-outbox";
import { sendMessengerMessage } from "@/adapters/messenger";
import { sendTelegramMessage } from "@/adapters/telegram";
import type { ConversationChannel, SendError } from "@/lib/conversations";
import { messengerPsid } from "@/lib/messenger";
import { currentPlatformMode, type PlatformMode } from "@/lib/social-mode";
import type { SocialFetch } from "@/lib/social-types";
import { currentTelegramMode, telegramStandInsAllowed, type TelegramMode } from "@/lib/telegram-mode";

// The ONLY door core code uses to send a chat message to a customer (step
// 47). Telegram (step 48) goes through adapters/telegram.ts, Messenger
// (step 53) through adapters/messenger.ts with the Page's token, which
// services/chat-send.ts reads first (only services decrypt tokens); the
// development stand-ins (the stand-in chat, a stand-in Telegram account or
// Facebook Page) write it to .dev-messages/, and production never uses
// them. Never logs the message.

// Where one message goes: the customer, and for Telegram the restaurant's
// connection (null: none is connected now).
export type ChatTarget = {
  channel: ConversationChannel;
  externalId: string;
  telegram: { businessConnectionId: string; isStandIn: boolean } | null;
  // Messenger (step 53): the Facebook Page's connection (null: none may send now).
  messenger?: { connectionId: string; pageId: string; isStandIn: boolean } | null;
};

// "unclear": the channel may or may not have it (no answer), so it is never
// sent again by itself. channelMessageId: the channel's own id for it, when
// it gives one (Telegram does; the stand-ins don't).
export type ChatDeliveryResult =
  | { status: "sent"; channelMessageId: string | null }
  | { status: "failed"; error: SendError }
  | { status: "unclear"; error: "no_answer" };

// Only the checks pass these: the NODE_ENV to act as, Telegram's and
// Facebook's modes, and a fake fetch. messengerToken: the Page's token,
// from services/chat-send.ts.
export type ChatDeliveryOptions = { nodeEnv?: string; telegramMode?: TelegramMode; facebookMode?: PlatformMode; fetchFn?: SocialFetch; messengerToken?: string };

export async function sendChatMessage(
  target: ChatTarget,
  message: { id: string; text: string },
  options: ChatDeliveryOptions = {},
): Promise<ChatDeliveryResult> {
  const nodeEnv = "nodeEnv" in options ? options.nodeEnv : process.env.NODE_ENV;
  if (target.channel === "stand_in") {
    return telegramStandInsAllowed(nodeEnv) ? writeToStandIn(message, `stand-in:${target.externalId}`) : notConnected();
  }
  if (target.channel === "messenger") {
    return sendToMessenger(target, message, options, nodeEnv);
  }
  if (target.channel !== "telegram" || !target.telegram) {
    return notConnected();
  }
  if (target.telegram.isStandIn) {
    return telegramStandInsAllowed(nodeEnv) ? writeToStandIn(message, `telegram:${target.externalId}`) : notConnected();
  }
  const mode = options.telegramMode ?? currentTelegramMode();
  if (mode.kind !== "real") {
    return notConnected();
  }
  return sendTelegramMessage(
    { token: mode.bot.token, fetchFn: options.fetchFn ?? fetch },
    { chatId: target.externalId, text: message.text, businessConnectionId: target.telegram.businessConnectionId },
  );
}

async function sendToMessenger(target: ChatTarget, message: { id: string; text: string }, options: ChatDeliveryOptions, nodeEnv: string | undefined): Promise<ChatDeliveryResult> {
  const psid = messengerPsid(target.externalId);
  if (!target.messenger || !psid) {
    return notConnected();
  }
  if (target.messenger.isStandIn) {
    return telegramStandInsAllowed(nodeEnv) ? writeToStandIn(message, `messenger:${target.externalId}`) : notConnected();
  }
  const mode = options.facebookMode ?? currentPlatformMode("facebook");
  if (mode.kind !== "real" || !options.messengerToken) {
    return notConnected();
  }
  return sendMessengerMessage(
    { fetchFn: options.fetchFn ?? fetch, appSecret: mode.credentials.clientSecret },
    { pageId: target.messenger.pageId, pageToken: options.messengerToken, psid, text: message.text },
  );
}

async function writeToStandIn(message: { id: string; text: string }, to: string): Promise<ChatDeliveryResult> {
  try {
    await writeStandInChatMessage({ id: message.id, to, text: message.text });
    return { status: "sent", channelMessageId: null };
  } catch (error) {
    console.error(`Stand-in chat delivery failed: ${error instanceof Error ? error.constructor.name : "unknown"}`);
    return { status: "failed", error: "not_connected" };
  }
}

function notConnected(): ChatDeliveryResult {
  return { status: "failed", error: "not_connected" };
}
