import "server-only";
import { isAPIError } from "better-auth/api";
import { z } from "zod";
import { deletePasswordResetLinks } from "@/db/users";
import { auth } from "@/lib/auth";
import type { FormErrors, FormResult } from "@/lib/form-result";
import { findAccountForResetLink } from "@/lib/password-reset-links";
import { getClientIpFromHeaders } from "@/lib/request-ip";
import { requestPasswordResetSchema, resetPasswordSchema } from "@/lib/validation/auth";
import { sendResetEmailsAfterResponse } from "./password-reset-email";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";
import { isUnconfirmedInvitee, removeUnconfirmedInvitee } from "./unconfirmed-invitees";
import type { RunAfterResponse } from "./vapi-webhook";

// Forgot password, through Better Auth's own reset (lib/auth.ts). Anyone can
// ask for a link for any address, so asking always gets the same answer, and
// the email is only sent after the response (services/password-reset-email.ts).
// requestHeaders are the incoming request's headers: the IP is the rate limit
// key. They are passed in so the checks can call these too, like
// runAfterResponse (the action passes Next.js's after()).

const tooManyRequestsError: FormResult = {
  ok: false,
  errors: { message: "Too many requests. Try again in an hour." },
};

// What using a reset link did. "account-removed": the link belonged to an
// unconfirmed account that joined a team through an invite, so it removed
// that account instead of setting a password (services/unconfirmed-invitees.ts).
export type ResetPasswordResult =
  | { ok: true; outcome: "password-changed" | "account-removed" }
  | { ok: false; errors: FormErrors };

const tooManyResetsError: ResetPasswordResult = {
  ok: false,
  errors: { message: "Too many attempts. Try again in 15 minutes." },
};

// One answer for a link that is malformed, unknown, used or expired.
const linkNotValidError: ResetPasswordResult = {
  ok: false,
  errors: { message: "This link has expired or is not valid. Ask for a new one." },
};

// Emails a reset link if the address has an account. The answer is the same
// either way, so the form never tells who has an account.
export async function requestPasswordReset(
  input: unknown,
  requestHeaders: Headers,
  runAfterResponse: RunAfterResponse,
): Promise<FormResult> {
  const parsed = requestPasswordResetSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  if (await isOverRateLimit("password-reset-request", getClientIpFromHeaders(requestHeaders), RATE_LIMITS.passwordResetRequestsPerIp)) {
    return tooManyRequestsError;
  }

  const { email } = parsed.data;
  // Over the per-address cap we skip without saying so: whoever asks may not
  // own the inbox. The links sent in the last hour still work, because the
  // window and the links both last one hour.
  if (await isOverRateLimit("password-reset-email", email, RATE_LIMITS.passwordResetEmailsPerAddress)) {
    return { ok: true };
  }
  try {
    await sendResetEmailsAfterResponse(runAfterResponse, () => auth.api.requestPasswordReset({ body: { email } }));
  } catch (error) {
    // Still the same answer: an error must not tell anything about the address.
    logUnexpectedResetError("reset request", error);
  }
  return { ok: true };
}

// Sets a new password with the token from a reset link. Better Auth ends every
// session of the account (revokeSessionsOnPasswordReset in lib/auth.ts) and
// the link works only once; the account's other links stop working too. An
// unconfirmed account still has to confirm its address afterwards (link plus
// the new password), like after signup, unless it joined a team through an
// invite: then the link removes that account instead (see ResetPasswordResult).
export async function resetPasswordWithToken(input: unknown, requestHeaders: Headers): Promise<ResetPasswordResult> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = z.flattenError(parsed.error).fieldErrors;
    // A malformed token is a bad link; only password problems go under the field.
    return fieldErrors.token ? linkNotValidError : { ok: false, errors: { fieldErrors } };
  }
  if (await isOverRateLimit("password-reset", getClientIpFromHeaders(requestHeaders), RATE_LIMITS.passwordResetsPerIp)) {
    return tooManyResetsError;
  }

  const { token, newPassword } = parsed.data;
  // Whose link this is decides what it may do, so it is looked up before
  // Better Auth sets any password.
  const account = await findAccountForResetLink(token);
  // A removed teammate's links are deleted and no new ones are sent
  // (services/password-reset-email.ts); one asked for in the same instant as
  // the removal is refused here. A new password couldn't let them in anyway.
  if (!account || account.deactivatedAt) {
    return linkNotValidError;
  }
  if (await isUnconfirmedInvitee(account)) {
    const removed = await removeUnconfirmedInvitee(account);
    if (removed) {
      return { ok: true, outcome: "account-removed" };
    }
    // The address was confirmed a moment ago: an ordinary reset from here on.
  }

  try {
    await auth.api.resetPassword({ body: { token, newPassword } });
  } catch (error) {
    if (!isAPIError(error) || error.status !== "BAD_REQUEST") {
      logUnexpectedResetError("password reset", error);
    }
    return linkNotValidError;
  }
  await cancelPasswordResetLinks(account.companyId, account.id);
  return { ok: true, outcome: "password-changed" };
}

// Makes every reset link of this person stop working, after their password
// changed: an earlier link may still sit in a shared or forwarded inbox. The
// password has already changed when this runs, so a failure is only logged.
export async function cancelPasswordResetLinks(companyId: string, userId: string): Promise<void> {
  try {
    await deletePasswordResetLinks(companyId, userId);
  } catch (error) {
    logUnexpectedResetError("reset link cleanup", error);
  }
}

// Logs only the error type and status, never the request body, so passwords,
// tokens and emails can't end up in the logs.
function logUnexpectedResetError(action: string, error: unknown): void {
  const status = isAPIError(error) ? error.status : "no status";
  const name = error instanceof Error ? error.name : typeof error;
  console.error(`Unexpected ${action} error: ${name} (${status})`);
}
