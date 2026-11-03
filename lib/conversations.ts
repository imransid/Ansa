// The Inbox's conversations (step 47): channels, who wrote a message, how an
// outgoing one was sent, and what the assistant's activity log records.
// Pure: the schema's CHECKs (db/schema/conversations.ts, messages.ts) and
// the pages share these lists; core uses the same values
// (core/internal/conversations, core/internal/chat).

// Where a customer writes from. "stand_in": the development stand-in chat
// (make simulate-message in core/), until Telegram (step 48), Messenger
// (step 53) and WhatsApp (step 56).
export const CONVERSATION_CHANNELS = ["telegram", "messenger", "whatsapp", "phone", "email", "stand_in"] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];

export const CHANNEL_LABELS: Record<ConversationChannel, string> = {
  telegram: "Telegram",
  messenger: "Messenger",
  whatsapp: "WhatsApp",
  phone: "Phone",
  email: "Email",
  stand_in: "Stand-in chat",
};

// Chat channels: a person can reply from the Inbox. Calls and emails show
// what came in; replying to them isn't done from ansa (yet).
export const CHAT_CHANNELS: ConversationChannel[] = ["telegram", "messenger", "whatsapp", "stand_in"];

// Who answers the conversation: the assistant (from step 49), or a person who
// took it over.
export const HANDLERS = ["assistant", "person"] as const;
export type ConversationHandler = (typeof HANDLERS)[number];

export const MESSAGE_DIRECTIONS = ["in", "out"] as const;
// "business_account": written in the business's own app (Telegram, step 48;
// its Facebook Page, step 53; the WhatsApp Business app, step 56), not from
// ansa, so no person of the team is named.
export const MESSAGE_AUTHORS = ["customer", "assistant", "person", "business_account"] as const;
export type MessageAuthor = (typeof MESSAGE_AUTHORS)[number];

// An outgoing message's delivery: "unclear" = the channel may or may not have
// it (no answer); "discarded" = an "Ask me first" draft the owner threw away.
export const SEND_STATUSES = ["draft", "sending", "sent", "failed", "unclear", "discarded"] as const;
export type SendStatus = (typeof SEND_STATUSES)[number];

// Why a message wasn't sent, or may not have been (step 48): a code, never
// the channel's own words. The page says each in plain words.
export const SEND_ERRORS = ["not_connected", "cannot_reply", "reply_window_closed", "refused", "bot_rejected", "rate_limited", "no_answer"] as const;
export type SendError = (typeof SEND_ERRORS)[number];

// Why a message wasn't sent, in plain words that name its channel.
export function sendErrorText(error: SendError, channel: ConversationChannel): string {
  const name = CHANNEL_LABELS[channel];
  switch (error) {
    case "not_connected":
      return `Not sent: ${name} isn't connected. Connect it in Settings → Connections.`;
    case "cannot_reply":
      return channel === "telegram"
        ? "Not sent: ansa isn't allowed to reply. Allow it in Telegram Business → Chatbots."
        : `Not sent: ansa isn't allowed to reply on ${name}. Connect it again in Settings → Connections.`;
    case "reply_window_closed":
      return `Not sent: ${name} lets ansa reply only within 24 hours of the customer's last message.`;
    case "refused":
      return `Not sent: ${name} refused it. The customer may have blocked the account, or the chat is closed to ansa.`;
    case "bot_rejected":
      return "Not sent: Telegram didn't accept ansa's bot. Contact ansa.";
    case "rate_limited":
      return `Not sent: ${name} asked ansa to slow down. Send it again in a minute.`;
    case "no_answer":
      return `Maybe not delivered: ${name} didn't answer. Check in ${name} before sending it again.`;
  }
}

// Where the business itself wrote a message ansa received (author "business_account").
export const WRITTEN_IN: Partial<Record<ConversationChannel, string>> = {
  telegram: "Written in Telegram",
  messenger: "Written on your Facebook Page",
  whatsapp: "Written in the WhatsApp Business app",
};

// What the activity log records. Actions with an actor are a person's; the
// others are the assistant's, which Home's "What ansa did" lists.
// Step 49: the assistant replied, wrote a reply that waits ("Ask me first"),
// or handed over to a person; a person sent or discarded a waiting reply.
export const ACTIVITY_ACTIONS = [
  "call_solved",
  "call_needs_person",
  "email_made_request",
  "taken_over",
  "handed_back",
  "replied",
  "drafted",
  "handed_over",
  "draft_sent",
  "draft_discarded",
  // Step 52: the customer said yes to ansa's order summary.
  "order_placed",
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

// The words of one activity row, after the customer's name.
export const ACTIVITY_TEXT: Record<ActivityAction, string> = {
  call_solved: "Answered a call",
  call_needs_person: "Took a call and kept a note for you",
  email_made_request: "Read an email and kept a note for you",
  taken_over: "Taken over by a person",
  handed_back: "Handed back to ansa",
  replied: "Answered a message",
  drafted: "Wrote a reply for you to check",
  handed_over: "Told them you'll get back to them",
  draft_sent: "Sent ansa's reply",
  draft_discarded: "Discarded ansa's reply",
  order_placed: "Took an order",
};

// The limits of a person's reply and of a contact's name.
export const REPLY_MAX_LENGTH = 4000;
export const CONTACT_NAME_MAX_LENGTH = 200;
