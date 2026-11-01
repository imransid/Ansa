import type { ConversationChannel } from "@/lib/conversations";

// The Inbox's views (step 47): "needs-you" (a conversation with an open
// request) and "all". Pure: the page, its links and the checks share them.

export const INBOX_VIEWS = ["needs-you", "all"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

// ?view= as the page reads it: anything else is "needs-you".
export function parseInboxView(value: unknown): InboxView {
  return INBOX_VIEWS.find((view) => view === value) ?? "needs-you";
}

// How a contact is named in the Inbox: the name the channel gave, else who
// they are on it (a number, an address), never the "unverified:" key.
export function contactLabel(contact: { displayName: string | null; externalId: string }): string {
  return contact.displayName ?? contact.externalId.replace(/^unverified:/, "");
}

// Whether an email contact's address was never verified (step 25).
export function isUnverifiedSender(contact: { channel: ConversationChannel; externalId: string }): boolean {
  return contact.channel === "email" && contact.externalId.startsWith("unverified:");
}
