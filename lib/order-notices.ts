import { CHANNEL_LABELS, type ConversationChannel } from "@/lib/conversations";

// Why a customer wasn't told their order's new status (core's answer to an
// Orders page button, core/internal/orders/status.go): a chat's refusal
// (core/internal/chat) or a send that failed. The status changed all the
// same. Pure, so the checks read every case.
export const ORDER_NOT_TOLD_REASONS = ["window-closed", "not-connected", "cannot-reply", "not-chat", "not-found", "send-failed"] as const;
export type OrderNotToldReason = (typeof ORDER_NOT_TOLD_REASONS)[number];

// Where the business answers a customer itself when ansa may not write.
const ANSWER_THEM_IN: Partial<Record<ConversationChannel, string>> = {
  telegram: "your Telegram app",
  messenger: "Meta Business Suite",
  whatsapp: "your WhatsApp Business app",
};

// What isn't connected, as the conversation page says it.
const CONNECTION_NAMES: Partial<Record<ConversationChannel, string>> = {
  telegram: "Telegram",
  messenger: "This Facebook Page",
  whatsapp: "This WhatsApp number",
};

// The reason in plain words that name the customer's channel (each chat has
// its own rules: a WhatsApp chat is no Telegram one).
export function orderNotToldText(reason: OrderNotToldReason, channel: ConversationChannel): string {
  const notTold = "The customer wasn't messaged.";
  const answerIn = ANSWER_THEM_IN[channel];
  switch (reason) {
    case "window-closed":
      return `${notTold} ${CHANNEL_LABELS[channel]} lets ansa write only within 24 hours of their last message.${answerIn ? ` Tell them in ${answerIn}.` : ""}`;
    case "not-connected":
      return `${notTold} ${CONNECTION_NAMES[channel] ?? CHANNEL_LABELS[channel]} isn't connected. Connect it in Settings → Connections.`;
    case "cannot-reply":
      return channel === "telegram"
        ? `${notTold} ansa isn't allowed to reply on your Telegram account. Allow it in Telegram Business → Chatbots.`
        : `${notTold} ansa may not send messages on ${CHANNEL_LABELS[channel]}. Connect it again in Settings → Connections.`;
    case "not-chat":
      return channel === "phone" ? `${notTold} They ordered on a call: call them back if they need to know.` : `${notTold} They didn't order in a chat.`;
    case "not-found":
      return notTold;
    case "send-failed":
      return "The message to the customer couldn't be sent: see the conversation.";
  }
}
