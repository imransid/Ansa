import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isActiveAccount } from "@/lib/active-account";
import { renderResetPasswordEmail } from "@/lib/emails/reset-password";
import { env } from "@/lib/env";
import { describeErrorWithFrames } from "@/lib/safe-error-logging";
import { buildAccountEmailFromHeader, sendEmail } from "@/lib/send-email";
import type { RunAfterResponse } from "./vapi-webhook";

// WHY the email waits: Better Auth makes the reset token inside
// auth.api.requestPasswordReset and hands it to our sendResetPassword
// (lib/auth.ts), but only when the address has an account. Sending right
// there would make those answers slower, and the difference would tell anyone
// which addresses have accounts. So the email goes out after the response,
// through the runAfterResponse function of the request that asked for it
// (services/password-reset.ts). Better Auth's callback takes no arguments of
// ours, so AsyncLocalStorage carries that function down to it for the length
// of that one call: requests running at the same time never see each other's.
const runAfterResponseForResetEmails = new AsyncLocalStorage<RunAfterResponse>();

// What we need from Better Auth's user record, checked rather than assumed.
const resetRecipientSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
});

type ResetRecipient = z.infer<typeof resetRecipientSchema>;

// Runs requestReset (the auth.api.requestPasswordReset call) so that the
// email it triggers is sent with runAfterResponse, after the response.
export function sendResetEmailsAfterResponse<T>(
  runAfterResponse: RunAfterResponse,
  requestReset: () => Promise<T>,
): Promise<T> {
  return runAfterResponseForResetEmails.run(runAfterResponse, requestReset);
}

// Called by Better Auth (lib/auth.ts) with a new reset token for an existing
// account. Only schedules the email; nothing is sent before the response.
export function schedulePasswordResetEmail(user: unknown, token: string): void {
  const runAfterResponse = runAfterResponseForResetEmails.getStore();
  if (!runAfterResponse) {
    // Only services/password-reset.ts asks for resets, rate limited (a check
    // enforces that). A link asked for any other way is not sent.
    console.error("Password reset email skipped: not asked for through services/password-reset.ts");
    return;
  }
  runAfterResponse(() => sendPasswordResetEmail(user, token));
}

// Runs after the response, so it must never throw. A database error's
// message can contain the address, so it is never logged: only the error's
// class, Postgres code, constraint and stack frames (describeErrorWithFrames).
// Every account gets its link, unconfirmed ones too: that is how the owner of
// an inbox takes back an address someone else signed up or joined a team with
// (services/password-reset.ts decides what the link may then do). The one
// exception is someone removed from their team: a password can't get them
// back in, so they get nothing. Skipping happens here, after the response, so
// the answer to the form takes as long either way.
async function sendPasswordResetEmail(user: unknown, token: string): Promise<void> {
  try {
    const recipient = resetRecipientSchema.safeParse(user);
    if (!recipient.success) {
      console.error("Password reset email skipped: unexpected user record");
      return;
    }
    if (!isActiveAccount(user)) {
      return;
    }
    await sendResetLink(recipient.data, token);
  } catch (error) {
    console.error(`Password reset email failed: ${describeErrorWithFrames(error)}`);
  }
}

// The token goes after "#" so it never reaches the server or its logs; the
// page reads it in the browser (app/reset-password). Better Auth's own `url`
// is not used: it points at the unmounted /api/auth handler, with the token
// in the path.
async function sendResetLink(recipient: ResetRecipient, token: string): Promise<void> {
  const content = renderResetPasswordEmail({ link: `${env.BETTER_AUTH_URL}/reset-password#${token}` });
  const result = await sendEmail({
    from: buildAccountEmailFromHeader(),
    to: recipient.email,
    replyTo: null,
    ...content,
    // A new key every time: each request is a new email with a new link.
    idempotencyKey: `reset-password-${recipient.id}-${randomUUID()}`,
  });
  if (!result.ok) {
    // Never log the address or the token.
    console.error("Could not send a password reset email");
  }
}
