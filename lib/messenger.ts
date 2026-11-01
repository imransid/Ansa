import { cutToLength } from "@/lib/cofounder/fact-proposals";
import { CONTACT_NAME_MAX_LENGTH } from "@/lib/conversations";
import type { ContactKey } from "@/lib/conversation-contacts";
import { toPlainSingleLine } from "@/lib/plain-text";

// What answering a Page's Messenger messages needs: sending them, and
// switching them on for ansa's app (subscribed_apps).
export const MESSAGING_SCOPES = ["pages_messaging", "pages_manage_metadata"];

// Facebook Messenger (step 53), pure: a customer is a Page-scoped id (PSID),
// so one person is a different customer on each Page; their contact's id
// names both, "<page id>:<psid>", and a reply goes back through that Page.

export function messengerContact(pageId: string, psid: string, name: string | null): ContactKey {
  const displayName = name ? cutToLength(toPlainSingleLine(name), CONTACT_NAME_MAX_LENGTH).trim() || null : null;
  return { channel: "messenger", externalId: `${pageId}:${psid}`, displayName };
}

// The split is at the LAST ":": a PSID never holds one, a development
// stand-in Page's id ("dev:stand-in") does.
export function messengerPageId(externalId: string): string | null {
  const at = externalId.lastIndexOf(":");
  return at > 0 && at < externalId.length - 1 ? externalId.slice(0, at) : null;
}

export function messengerPsid(externalId: string): string | null {
  const at = externalId.lastIndexOf(":");
  return at > 0 && at < externalId.length - 1 ? externalId.slice(at + 1) : null;
}

// What a message without text says in the Inbox (attachments are never
// downloaded: open Messenger to see them).
export function describeMessengerMessage(message: { text?: string; attachments?: { type: string }[] }): string | null {
  if (message.text && message.text.trim() !== "") {
    return message.text;
  }
  const kind = message.attachments?.[0]?.type;
  if (!kind) {
    return null;
  }
  const named: Record<string, string> = { image: "A photo", video: "A video", audio: "A voice message", file: "A file", sticker: "A sticker" };
  return `[${named[kind] ?? "Something"}: open Messenger to see it]`;
}
