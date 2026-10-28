import "server-only";
import { isAPIError } from "better-auth/api";
import { z } from "zod";
import {
  auth,
  isCorrectPasswordForEmail,
  readEmailFromVerificationToken,
  spendPasswordCheckTime,
} from "@/lib/auth";
import type { FormResult } from "@/lib/form-result";
import { createKnownDeviceCookieValue, type RememberBrowser } from "@/lib/known-device";
import { getClientIpFromHeaders } from "@/lib/request-ip";
import { confirmEmailSchema, loginSchema } from "@/lib/validation/auth";
import {
  describeLoginAttempt,
  findLoginLimitReached,
  forgetSuccessfulLogin,
  waitAfterLimit,
  type LoginLimit,
} from "./login-limits";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Everything that opens or closes a session: login, confirming an email
// address, logout. (Creating accounts is services/signup.ts, password reset
// services/password-reset.ts, password change services/account.ts.)
// requestHeaders are the incoming request's headers: the IP is the rate limit
// key and the cookies are the session and the known-device cookie.
// rememberBrowser hands this browser a new known-device cookie after a login
// that worked (lib/known-device.ts). Both are passed in so the checks can call
// these too.

// Logs in with email and password and sets the session cookie.
export async function logIn(input: unknown, requestHeaders: Headers, rememberBrowser: RememberBrowser): Promise<FormResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors },
    };
  }

  const { email, password } = parsed.data;
  const attempt = describeLoginAttempt(email, requestHeaders);
  const limitReached = await findLoginLimitReached(attempt);
  if (limitReached) {
    return { ok: false, errors: { message: getTooManyLoginsMessage(limitReached) } };
  }

  try {
    await auth.api.signInEmail({ body: { email, password }, headers: requestHeaders });
  } catch (error) {
    if (isEmailNotVerifiedError(error)) {
      // Better Auth checks the password before it says this, so the password
      // was right: not a failed attempt.
      await forgetSuccessfulLogin(attempt);
    }
    return { ok: false, errors: { message: getLoginErrorMessage(error) } };
  }

  await forgetSuccessfulLogin(attempt);
  await rememberBrowser(createKnownDeviceCookieValue(email));
  return { ok: true };
}

// One answer for a bad link and for a wrong password, so neither can be
// tested on its own.
const wrongLinkOrPasswordError: FormResult = {
  ok: false,
  errors: { message: "This link has expired or the password is wrong. Try your password again, or log in to get a new link." },
};

// The confirm page's answer when a login limit refused the attempt.
function tooManyConfirmAttemptsError(limit: LoginLimit): FormResult {
  return { ok: false, errors: { message: `Too many attempts. Try again in ${waitAfterLimit(limit)}.` } };
}

// Confirms an email address with the link from the verification email AND the
// account's password, then logs the user in. A link alone never confirms or
// logs in anyone: whoever signed up first with someone else's address knows
// the password but never sees the link, and the inbox owner sees the link but
// doesn't know that password (see lib/auth.ts).
export async function confirmEmailWithPassword(
  input: unknown,
  requestHeaders: Headers,
  rememberBrowser: RememberBrowser,
): Promise<FormResult> {
  const parsed = confirmEmailSchema.safeParse(input);
  if (!parsed.success) {
    return wrongLinkOrPasswordError;
  }
  if (await isOverRateLimit("verify-email", getClientIpFromHeaders(requestHeaders), RATE_LIMITS.verifyEmailPerIp)) {
    return tooManyConfirmAttemptsError("ip");
  }

  const { token, password } = parsed.data;
  const email = await readEmailFromVerificationToken(token);
  if (!email) {
    await spendPasswordCheckTime(password);
    return wrongLinkOrPasswordError;
  }
  // The same counters as /login, so password guesses on both pages add up.
  const attempt = describeLoginAttempt(email, requestHeaders);
  const limitReached = await findLoginLimitReached(attempt);
  if (limitReached) {
    return tooManyConfirmAttemptsError(limitReached);
  }
  if (!(await isCorrectPasswordForEmail(email, password))) {
    return wrongLinkOrPasswordError;
  }
  // The password is right, so this is not a failed attempt, whatever happens next.
  await forgetSuccessfulLogin(attempt);

  const result = await confirmAndLogIn(token, email, password, requestHeaders);
  if (result.ok) {
    await rememberBrowser(createKnownDeviceCookieValue(email));
  }
  return result;
}

// Only called once the link and the password have both checked out.
async function confirmAndLogIn(token: string, email: string, password: string, requestHeaders: Headers): Promise<FormResult> {
  try {
    // Checks the token again (signature, expiry, account) and sets
    // email_verified. It opens no session: autoSignInAfterVerification is off.
    await auth.api.verifyEmail({ query: { token } });
  } catch (error) {
    // The link can expire between our check and this one: Better Auth then
    // answers UNAUTHORIZED. Anything else (the database, say) is our problem,
    // and saying "expired" would send people to fetch links that work.
    if (isAPIError(error) && error.status === "UNAUTHORIZED") {
      return wrongLinkOrPasswordError;
    }
    logUnexpectedAuthError("email confirmation", error);
    return { ok: false, errors: { message: "Your email address could not be confirmed because of a problem on our side. Try again in a few minutes." } };
  }

  try {
    await auth.api.signInEmail({ body: { email, password }, headers: requestHeaders });
  } catch (error) {
    logUnexpectedAuthError("login after confirming", error);
    return { ok: false, errors: { message: "Your email address is confirmed. Log in to continue." } };
  }
  return { ok: true };
}

// Ends the current session and clears the session cookie.
export async function logOut(requestHeaders: Headers): Promise<void> {
  await auth.api.signOut({ headers: requestHeaders });
}

// The login page's message for the limit that refused the attempt.
function getTooManyLoginsMessage(limit: LoginLimit): string {
  const wait = waitAfterLimit(limit);
  if (limit === "address") {
    // Only browsers that never logged in to this account get this far
    // (services/login-limits.ts), so another browser may still work.
    return `Too many failed logins for this address. Try again in ${wait}, or from a browser you have logged in with before.`;
  }
  return `Too many login attempts. Try again in ${wait}.`;
}

// Says whether Better Auth refused a login because the address isn't confirmed yet.
function isEmailNotVerifiedError(error: unknown): boolean {
  return isAPIError(error) && error.body?.code === "EMAIL_NOT_VERIFIED";
}

// Turns Better Auth's answer to a refused login into the message the page shows.
function getLoginErrorMessage(error: unknown): string {
  if (isAPIError(error) && error.status === "UNAUTHORIZED") {
    return "Email or password is incorrect.";
  }
  if (isEmailNotVerifiedError(error)) {
    // Better Auth has just mailed a new link, unless this address already got
    // 3 in the last hour (services/email-verification.ts). Then an earlier
    // one still works, so "the newest" is right either way.
    return "Please confirm your email address first: open the newest confirmation email we sent you.";
  }
  logUnexpectedAuthError("login", error);
  return "Could not log you in. Please try again.";
}

// Logs only the error type and status, never the request body,
// so passwords and emails can't end up in the logs.
function logUnexpectedAuthError(action: string, error: unknown): void {
  const status = isAPIError(error) ? error.status : "no status";
  const name = error instanceof Error ? error.name : typeof error;
  console.error(`Unexpected ${action} error: ${name} (${status})`);
}
