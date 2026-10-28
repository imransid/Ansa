import "server-only";
import { writeToDevOutbox } from "@/adapters/dev-email-outbox";
import { sendWithResend } from "@/adapters/resend";
import { env } from "@/lib/env";
import { toPlainSingleLine } from "@/lib/plain-text";
import { site } from "@/lib/site";

// The one shape every email sender understands. Core code builds this and
// calls sendEmail; it never talks to Resend (or the dev outbox) directly.
export type EmailMessage = {
  from: string;
  to: string;
  replyTo: string | null;
  subject: string;
  html: string;
  text: string;
  // Sending the same key twice must never deliver twice.
  idempotencyKey: string;
};

export type EmailSendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; error: string };

// Used as the From address in the dev outbox, where EMAIL_FROM may be unset.
const DEV_FROM_ADDRESS = "no-reply@example.test";

// The one address every email we send comes from: EMAIL_FROM, or the dev
// stand-in. Shared by every company.
export function getSendingAddress(): string {
  return env.EMAIL_FROM ?? DEV_FROM_ADDRESS;
}

// True for our own sending address, in any letter case. Mail to it belongs to
// no company, so no company may list it as its support address.
export function isOurSendingAddress(address: string): boolean {
  return address.trim().toLowerCase() === getSendingAddress().toLowerCase();
}

// Real email only when SEND_REAL_EMAIL is exactly "true" (see lib/env.ts).
export function isRealEmailOn(): boolean {
  return env.SEND_REAL_EMAIL === "true";
}

// Sends one email, or writes it to .dev-emails/ when real email is off.
export async function sendEmail(message: EmailMessage): Promise<EmailSendResult> {
  if (isRealEmailOn()) {
    return sendWithResend(message);
  }
  return writeToDevOutbox(message);
}

// The From header of the emails ansa sends about a person's own account
// (confirm your email, you already have an account, reset your password):
// "ansa" <EMAIL_FROM>. No company name: these come from ansa itself.
export function buildAccountEmailFromHeader(): string {
  return `"${site.name}" <${getSendingAddress()}>`;
}

// Room for the company's name in the sender name, so " via ansa" always fits.
const MAX_SENDER_COMPANY_CHARACTERS = 60;

// Builds the From header of customer and assignment emails:
// "Acme via ansa" <support@ourdomain.com>. Every company sends from our one
// shared address and its owner types its name, so the name never stands alone:
// "via ansa" shows who really sent it. The name is cleaned first:
// 1. NFKC turns look-alikes into the characters they imitate (＠ and ﹫
//    become @, ＜ becomes <), so step 3 removes them too. It also turns ™
//    into TM, which is fine in a sender name.
// 2. One plain line: no line breaks, no invisible right-to-left tricks. Done
//    before step 3, so an invisible character can't hide a "=?" from it.
// 3. Quotes, angle brackets and backslashes (they could break out of the
//    header), "@" (a name like "security@paypal.com" would pose as an address)
//    and "=?" / "?=" become spaces. The last two start and end an encoded-word
//    ("=?UTF-8?Q?...?="), which some mail clients decode even inside the
//    quotes, so one could spell out an address.
export function buildFromHeader(companyName: string): string {
  const plainName = toPlainSingleLine(companyName.normalize("NFKC"));
  const withoutAddressParts = plainName.replace(/[@"<>\\]/g, " ").replace(/=\?|\?=/g, " ");
  // Again, only to merge the spaces step 3 left.
  const companyPart = toPlainSingleLine(withoutAddressParts).slice(0, MAX_SENDER_COMPANY_CHARACTERS).trim();
  // A name made only of removed characters leaves just our own name.
  const senderName = companyPart ? `${companyPart} via ${site.name}` : site.name;
  return `"${senderName}" <${getSendingAddress()}>`;
}
