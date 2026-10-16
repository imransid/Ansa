import "server-only";
import { writeToDevOutbox } from "@/adapters/dev-email-outbox";
import { sendWithResend } from "@/adapters/resend";
import { env } from "@/lib/env";

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

// Builds a From header like "Acme Support <support@ourdomain.com>".
// Company names are typed by users, so characters that could break out of the
// header (quotes, angle brackets, line breaks, backslashes) are removed first.
export function buildFromHeader(companyName: string): string {
  const address = env.EMAIL_FROM ?? DEV_FROM_ADDRESS;
  const safeName = `${companyName} Support`
    .replace(/\p{Cc}/gu, "") // control characters, including line breaks
    .replace(/["<>\\]/g, "")
    .trim()
    .slice(0, 70);
  return `"${safeName}" <${address}>`;
}
