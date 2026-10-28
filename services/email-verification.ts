import "server-only";
import { randomUUID } from "node:crypto";
import { renderExistingAccountEmail } from "@/lib/emails/existing-account";
import { renderVerifyEmail } from "@/lib/emails/verify-email";
import { env } from "@/lib/env";
import { buildAccountEmailFromHeader, sendEmail } from "@/lib/send-email";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

type AccountEmailRecipient = { id: string; email: string };

// Sends the "confirm your email" email. Called by Better Auth (lib/auth.ts)
// after signup and when an unconfirmed user tries to log in.
// The token goes after "#" so it never reaches the server or its logs; the
// page reads it in the browser (app/verify-email).
export async function sendVerificationEmail(user: AccountEmailRecipient, token: string): Promise<void> {
  // Over the cap we skip without telling the person who asked: they may not
  // own the inbox. The address still has a link from the last hour, because
  // the window and the link both last one hour.
  if (await isOverRateLimit("verification-email", user.email, RATE_LIMITS.verificationEmailsPerAddress)) {
    return;
  }
  const content = renderVerifyEmail({ link: `${env.BETTER_AUTH_URL}/verify-email#${token}` });
  const result = await sendEmail({
    from: buildAccountEmailFromHeader(),
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

// Sends "you already have an ansa account" to an address someone just tried to
// sign up (or join a team) with. Called by Better Auth (lib/auth.ts,
// onExistingUserSignUp). The form shows the normal "check your email" page.
export async function sendExistingAccountEmail(user: AccountEmailRecipient): Promise<void> {
  // Anyone can type any address into the signup form, so this is capped too.
  if (await isOverRateLimit("existing-account-email", user.email, RATE_LIMITS.existingAccountEmailsPerAddress)) {
    return;
  }
  const content = renderExistingAccountEmail({
    loginLink: `${env.BETTER_AUTH_URL}/login`,
    resetPasswordLink: `${env.BETTER_AUTH_URL}/forgot-password`,
  });
  const result = await sendEmail({
    from: buildAccountEmailFromHeader(),
    to: user.email,
    replyTo: null,
    ...content,
    // A new key every time: each attempt is its own email.
    idempotencyKey: `existing-account-${user.id}-${randomUUID()}`,
  });
  if (!result.ok) {
    // Never log the address.
    console.error("Could not send an existing-account email");
  }
}
