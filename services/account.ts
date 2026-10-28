import "server-only";
import { isAPIError } from "better-auth/api";
import { z } from "zod";
import { countActiveSessions, updateUserName } from "@/db/users";
import { auth } from "@/lib/auth";
import type { FormErrors, FormResult } from "@/lib/form-result";
import type { SessionContext } from "@/lib/session";
import { changeNameSchema, changePasswordSchema } from "@/lib/validation/account";
import { cancelPasswordResetLinks } from "./password-reset";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// The Account page: your own name, your password and where you are logged in.
// requestHeaders are the incoming request's headers: Better Auth finds the
// session in their cookie (the same request the session came from). They are
// passed in so the checks can call these too.

export type AccountDetails = {
  name: string;
  email: string;
  // Browsers and devices logged in right now, this one included.
  activeSessionCount: number;
};

const tooManyChangesError: FormResult = {
  ok: false,
  errors: { message: "Too many changes. Try again in a few minutes." },
};

const tooManyPasswordChangesError: FormResult = {
  ok: false,
  errors: { message: "Too many attempts. Try again in 15 minutes." },
};

// What the Account page shows for the logged-in user.
export async function getAccountForSession(session: SessionContext): Promise<AccountDetails> {
  return {
    name: session.name,
    email: session.email,
    activeSessionCount: await countActiveSessions(session.companyId, session.userId),
  };
}

// Changes the logged-in user's own name (shown to teammates and in assignee lists).
export async function changeNameForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const parsed = changeNameSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  if (await isOverRateLimit("account-changes", session.userId, RATE_LIMITS.accountChangesPerUser)) {
    return tooManyChangesError;
  }
  await updateUserName(session.companyId, session.userId, parsed.data.name);
  return { ok: true };
}

// Changes the logged-in user's password once the current one checks out, and
// logs them out everywhere else. This browser gets a fresh login, and any
// reset link sent earlier stops working.
export async function changePasswordForSession(
  session: SessionContext,
  input: unknown,
  requestHeaders: Headers,
): Promise<FormResult> {
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors } };
  }
  // Counts every attempt: someone at a browser left logged in must not get
  // unlimited guesses at the current password.
  if (await isOverRateLimit("password-change", session.userId, RATE_LIMITS.passwordChangesPerUser)) {
    return tooManyPasswordChangesError;
  }

  const { currentPassword, newPassword } = parsed.data;
  try {
    // revokeOtherSessions: Better Auth deletes every login of this user, then
    // opens a new one and sets its cookie (nextCookies, in the server action).
    await auth.api.changePassword({
      body: { currentPassword, newPassword, revokeOtherSessions: true },
      headers: requestHeaders,
    });
  } catch (error) {
    return { ok: false, errors: getChangePasswordErrors(error) };
  }
  // Someone who changes a password because they fear their email was read
  // must not leave a working reset link in that inbox.
  await cancelPasswordResetLinks(session.companyId, session.userId);
  return { ok: true };
}

// Logs the logged-in user out on every other browser and device, keeping this one.
export async function signOutOtherDevicesForSession(session: SessionContext, requestHeaders: Headers): Promise<FormResult> {
  if (await isOverRateLimit("account-changes", session.userId, RATE_LIMITS.accountChangesPerUser)) {
    return tooManyChangesError;
  }
  try {
    await auth.api.revokeOtherSessions({ headers: requestHeaders });
  } catch (error) {
    logUnexpectedAccountError("sign out other devices", error);
    return { ok: false, errors: { message: "Could not log out your other devices. Please try again." } };
  }
  return { ok: true };
}

// Turns Better Auth's answer to a refused password change into the form's errors.
function getChangePasswordErrors(error: unknown): FormErrors {
  if (isAPIError(error) && error.body?.code === "INVALID_PASSWORD") {
    return { fieldErrors: { currentPassword: ["That is not your current password."] } };
  }
  if (isAPIError(error) && error.status === "UNAUTHORIZED") {
    return { message: "You were logged out. Log in again to change your password." };
  }
  logUnexpectedAccountError("password change", error);
  return { message: "Could not change your password. Please try again." };
}

// Logs only the error type and status, never the request body, so passwords
// can't end up in the logs.
function logUnexpectedAccountError(action: string, error: unknown): void {
  const status = isAPIError(error) ? error.status : "no status";
  const name = error instanceof Error ? error.name : typeof error;
  console.error(`Unexpected ${action} error: ${name} (${status})`);
}
