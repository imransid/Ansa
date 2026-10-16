import "server-only";
import { randomUUID } from "node:crypto";
import { renderVerifyEmail } from "@/lib/emails/verify-email";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/send-email";

// How long a verification link works.
export const VERIFICATION_LINK_SECONDS = 60 * 60;

// Sends the "confirm your email" email. Called by Better Auth (lib/auth.ts)
// after signup and when an unconfirmed user tries to log in.
// The token goes after "#" so it never reaches the server or its logs; the
// page reads it in the browser (app/verify-email).
export async function sendVerificationEmail(user: { id: string; email: string; name: string }, token: string): Promise<void> {
  const content = renderVerifyEmail({ name: user.name, link: `${env.BETTER_AUTH_URL}/verify-email#${token}` });
  const result = await sendEmail({
    from: `"ansa" <${env.EMAIL_FROM ?? "no-reply@example.test"}>`,
    to: user.email,
    replyTo: null,
    ...content,
    // A new key every time: each resend is a new email with a new link.
    idempotencyKey: `verify-email-${user.id}-${randomUUID()}`,
  });
  if (!result.ok) {
    // Never log the address or the token.
    console.error("Could not send a verification email");
  }
}
