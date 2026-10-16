import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env";
import type { EmailMessage, EmailSendResult } from "@/lib/send-email";

// Translates our EmailMessage into a Resend API call.
// Only used when SEND_REAL_EMAIL=true (lib/env.ts then requires the API key).
export async function sendWithResend(message: EmailMessage): Promise<EmailSendResult> {
  if (!env.RESEND_API_KEY) {
    return { ok: false, error: "RESEND_API_KEY is not set" };
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const { data, error } = await resend.emails.send(
    {
      from: message.from,
      to: message.to,
      replyTo: message.replyTo ?? undefined,
      subject: message.subject,
      html: message.html,
      text: message.text,
    },
    { idempotencyKey: message.idempotencyKey },
  );

  if (error) {
    // Resend error names and messages never include the API key.
    return { ok: false, error: `${error.name}: ${error.message}` };
  }
  return { ok: true, providerMessageId: data.id };
}
