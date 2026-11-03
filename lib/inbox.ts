import { CHANNEL_LABELS, CHAT_CHANNELS, type ConversationChannel } from "@/lib/conversations";

// The Inbox's views (step 47): "needs-you" (a conversation with an open
// request) and "all". Pure: the page and its links share them; core reads
// the same two (core/internal/inbox).

export const INBOX_VIEWS = ["needs-you", "all"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

// ?view= as the page reads it: anything else is "needs-you".
export function parseInboxView(value: unknown): InboxView {
  return INBOX_VIEWS.find((view) => view === value) ?? "needs-you";
}

// How a contact is named in the Inbox: the name the channel gave, else who
// they are on it: an address or a number as written (never the
// "unverified:" key), and on a chat channel "<app> customer" (a chat or
// Page-scoped id means nothing to a person; Messenger and WhatsApp may give
// no name).
export function contactLabel(contact: { displayName: string | null; externalId: string; channel: ConversationChannel }): string {
  if (contact.displayName !== null) {
    return contact.displayName;
  }
  if (CHAT_CHANNELS.includes(contact.channel)) {
    return `${CHANNEL_LABELS[contact.channel]} customer`;
  }
  return contact.externalId.replace(/^unverified:/, "");
}

// Whether an email contact's address was never verified (step 25).
export function isUnverifiedSender(contact: { channel: ConversationChannel; externalId: string }): boolean {
  return contact.channel === "email" && contact.externalId.startsWith("unverified:");
}
