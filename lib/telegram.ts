// Telegram (step 48): a restaurant adds ansa's one bot to its own Telegram
// account as a Telegram Business chatbot, and its customers' messages reach
// the Inbox. Pure: the schema's CHECKs (db/schema/channels.ts) and the pages
// share these rules; core keeps its own (core/internal/telegram).

// How a restaurant's Telegram account stands with ansa:
// "connected": messages come in and replies go out.
// "cannot_reply": connected, but the owner didn't allow the bot to reply
//   (Telegram Business → Chatbots: the "reply to messages" permission).
// "removed_in_telegram": the owner removed the bot in Telegram. Adding it
//   back in Telegram connects it again.
// "disconnected": an owner pressed Disconnect in ansa. Connecting again
//   needs a new link from ansa.
export const CHANNEL_CONNECTION_STATUSES = ["connected", "cannot_reply", "removed_in_telegram", "disconnected"] as const;
export type ChannelConnectionStatus = (typeof CHANNEL_CONNECTION_STATUSES)[number];

// The statuses that keep a Telegram account tied to its company: one
// company at a time, and one such account per company.
export const LIVE_CONNECTION_STATUSES: ChannelConnectionStatus[] = ["connected", "cannot_reply", "removed_in_telegram"];

export const CONNECTION_STATUS_TEXT: Record<ChannelConnectionStatus, string> = {
  connected: "Connected",
  cannot_reply: "Connected, but ansa may not reply",
  removed_in_telegram: "Removed in Telegram",
  disconnected: "Disconnected",
};

// The one-time link an owner opens to connect (Settings → Connections): it
// works for 10 minutes. Once the owner pressed Start with it, ansa waits an
// hour for the bot to be added under Telegram Business → Chatbots, and keeps
// a bot added before the Start for an hour too (telegram_pending_connections).
export const LINK_CODE_LIFETIME_MINUTES = 10;
export const LINK_WAIT_MINUTES = 60;

// Telegram lets a business chatbot send messages only in chats with a
// customer message in the last 24 hours (BusinessBotRights.can_reply).
export const REPLY_WINDOW_HOURS = 24;

// Telegram's limit for one message's text (sendMessage: 1-4096 characters).
export const TELEGRAM_TEXT_MAX_LENGTH = 4096;

// The updates ansa asks Telegram for (setWebhook and getUpdates): the
// owner's /start with the code, the business connection, customers'
// messages, and messages deleted in Telegram.
export const TELEGRAM_UPDATE_TYPES = ["message", "business_connection", "business_message", "deleted_business_messages"];

// The deep link that opens ansa's bot with the code: Telegram allows A-Z,
// a-z, 0-9, _ and - up to 64 characters; the code is 43.
export function telegramStartLink(botUsername: string, code: string): string {
  return `https://t.me/${botUsername}?start=${code}`;
}

// The code in a "/start <code>" message, or null. Telegram sends the
// deep link's parameter after "/start " (also "/start@botname <code>").
export function readStartCode(text: string | undefined): string | null {
  const match = /^\/start(?:@[A-Za-z0-9_]+)?\s+([A-Za-z0-9_-]{43})$/.exec(text?.trim() ?? "");
  return match ? match[1] : null;
}

// What isn't text, as ansa names it. Only a message's text and caption are
// stored; anything else is named, and opened in Telegram.
const MEDIA_LABELS = {
  photo: "A photo",
  video: "A video",
  video_note: "A video message",
  animation: "A GIF",
  voice: "A voice message",
  audio: "An audio file",
  document: "A file",
  sticker: "A sticker",
  location: "A location",
  venue: "A place",
  contact: "A contact",
  poll: "A poll",
} as const;
export type TelegramMediaKind = keyof typeof MEDIA_LABELS;
export const TELEGRAM_MEDIA_KINDS = Object.keys(MEDIA_LABELS) as TelegramMediaKind[];

// The text ansa keeps of one Telegram message: its text or caption, and a
// line naming what else it held ("A photo: open Telegram to see it").
// null: nothing at all to show (a kind Telegram added that ansa doesn't name).
export function describeTelegramMessage(message: { text?: string; caption?: string; mediaKind: TelegramMediaKind | null }): string | null {
  const words = (message.text ?? message.caption ?? "").trim();
  const note = message.mediaKind ? `[${MEDIA_LABELS[message.mediaKind]}: open Telegram to see it]` : "";
  const text = [note, words].filter(Boolean).join("\n");
  return text ? text.slice(0, TELEGRAM_TEXT_MAX_LENGTH) : null;
}

// A Telegram user's name as one line: "Lena Moretti", else "@lena", else null.
export function telegramDisplayName(user: { first_name?: string; last_name?: string; username?: string }): string | null {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if (name) {
    return name;
  }
  return user.username ? `@${user.username}` : null;
}

// What the bot says to the owner in its own chat. Fixed text: never a
// customer's words, never anything another company could be told.
export const BOT_NOTES = {
  waitingForChatbot:
    "Thanks! Now add me as your chatbot: Telegram Settings → Telegram Business → Chatbots, type my username, choose the chats, and allow me to reply. If I'm already there, remove me and add me again.",
  connected: "Connected to ansa. Your customers' messages now show in ansa's Inbox.",
  connectedCannotReply:
    "Connected to ansa, but I'm not allowed to reply. Allow it under Telegram Business → Chatbots so ansa can answer your customers.",
  linkExpired: "This link has expired or was used already. Open ansa → Settings → Connections and press Connect Telegram again.",
  needsLink: "To use me with ansa, open ansa → Settings → Connections and press Connect Telegram.",
  alreadyConnectedElsewhere: "This Telegram account is connected to another ansa account. Disconnect it there first.",
  companyHasAnother: "Your ansa account already has another Telegram account connected. Disconnect it in ansa first.",
} as const;
