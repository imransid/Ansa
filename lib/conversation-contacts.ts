import { cutToLength } from "@/lib/cofounder/fact-proposals";
import type { ConversationChannel } from "@/lib/conversations";
import { CONTACT_NAME_MAX_LENGTH } from "@/lib/conversations";
import { customerPhoneDigits } from "@/lib/phone-number";
import { toPlainSingleLine } from "@/lib/plain-text";
import { telegramDisplayName } from "@/lib/telegram";

// Who a call or an email comes from, as an Inbox contact (step 47): the same
// customer joins the same conversation. Pure.

export type ContactKey = { channel: ConversationChannel; externalId: string; displayName: string | null };

// A caller, by the digits of their number (never a hidden caller's
// placeholder: lib/phone-number.ts), shown as the number. null: no number to
// tell callers apart, so the call joins no conversation.
export function phoneContact(callerNumber: string | null): ContactKey | null {
  const digits = customerPhoneDigits(callerNumber);
  if (!digits || !callerNumber) {
    return null;
  }
  return { channel: "phone", externalId: digits, displayName: cleanName(callerNumber) };
}

// A sender, by their lowercased address. Only a verified sender (step 25)
// joins a conversation under the address itself; an unverified one gets a
// conversation of its own ("unverified:<address>"), so a forged From never
// adds to a real customer's conversation. null: no address was read.
export function emailContact(fromAddress: string | null, senderVerified: boolean, name: string | null): ContactKey | null {
  if (!fromAddress) {
    return null;
  }
  const address = fromAddress.toLowerCase();
  return { channel: "email", externalId: senderVerified ? address : `unverified:${address}`, displayName: cleanName(name ?? address) };
}

// A Telegram customer (step 48), by their private chat's id (the same as
// their user id), shown by the name Telegram gives.
export function telegramContact(chat: { id: string; first_name?: string; last_name?: string; username?: string }): ContactKey {
  return { channel: "telegram", externalId: chat.id, displayName: cleanName(telegramDisplayName(chat) ?? "") };
}

// A stand-in chat customer (pnpm simulate:message), by the name given.
export function standInContact(name: string): ContactKey {
  const displayName = cleanName(name) ?? "Stand-in customer";
  return { channel: "stand_in", externalId: displayName.toLowerCase(), displayName };
}

function cleanName(name: string): string | null {
  const plain = cutToLength(toPlainSingleLine(name), CONTACT_NAME_MAX_LENGTH).trim();
  return plain || null;
}
