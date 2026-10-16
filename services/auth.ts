import "server-only";
import { headers } from "next/headers";
import { isAPIError } from "better-auth/api";
import { z } from "zod";
import { auth } from "@/lib/auth";
import type { FormResult } from "@/lib/form-result";
import { getClientIp } from "@/lib/request-ip";
import { loginSchema, signupSchema } from "@/lib/validation/auth";
import { joinWithInviteSchema } from "@/lib/validation/invites";
import { MEMBERSHIP_ERROR_CODES } from "./company-membership";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Creates a new company with the signing-up person as its owner, then logs them in.
export async function signUpCompanyOwner(input: unknown): Promise<FormResult> {
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors },
    };
  }

  const ip = await getClientIp();
  if (await isOverRateLimit("signup", ip, RATE_LIMITS.signupPerIp)) {
    return {
      ok: false,
      errors: { message: "Too many signup attempts. Try again in an hour." },
    };
  }

  const { companyName, name, email, password } = parsed.data;
  // We never send companyId or role. The user-create hook in lib/auth.ts
  // reads companyName, creates the company, and sets both on the new user.
  // Better Auth passes extra body fields like companyName through at runtime,
  // but its types don't list them, so the body is built before the call.
  const signupBody = { name, email, password, companyName };
  try {
    await auth.api.signUpEmail({
      body: signupBody,
      headers: await headers(),
    });
  } catch (error) {
    return { ok: false, errors: { message: getSignupErrorMessage(error) } };
  }

  return { ok: true };
}

// Creates an account from an invite link, joins the inviting company, then logs in.
export async function joinCompanyWithInvite(input: unknown): Promise<FormResult> {
  const parsed = joinWithInviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors },
    };
  }

  const ip = await getClientIp();
  if (await isOverRateLimit("signup", ip, RATE_LIMITS.signupPerIp)) {
    return {
      ok: false,
      errors: { message: "Too many signup attempts. Try again in an hour." },
    };
  }

  const { inviteToken, name, email, password } = parsed.data;
  // The user-create hook in lib/auth.ts sees inviteToken, checks the invite
  // matches this email, and takes company and role from the invite.
  const signupBody = { name, email, password, inviteToken };
  try {
    await auth.api.signUpEmail({
      body: signupBody,
      headers: await headers(),
    });
  } catch (error) {
    return { ok: false, errors: { message: getSignupErrorMessage(error) } };
  }

  return { ok: true };
}

// Logs in with email and password and sets the session cookie.
export async function logIn(input: unknown): Promise<FormResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors },
    };
  }

  const { email, password } = parsed.data;
  const ip = await getClientIp();
  // Limit per IP (one attacker, many accounts) and per email (many IPs, one account).
  const tooManyFromThisIp = await isOverRateLimit("login-ip", ip, RATE_LIMITS.loginPerIp);
  const tooManyForThisEmail = await isOverRateLimit("login-email", email, RATE_LIMITS.loginPerEmail);
  if (tooManyFromThisIp || tooManyForThisEmail) {
    return {
      ok: false,
      errors: { message: "Too many login attempts. Try again in 15 minutes." },
    };
  }

  try {
    await auth.api.signInEmail({
      body: { email, password },
      headers: await headers(),
    });
  } catch (error) {
    return { ok: false, errors: { message: getLoginErrorMessage(error) } };
  }

  return { ok: true };
}

// Ends the current session and clears the session cookie.
export async function logOut(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
}

function getSignupErrorMessage(error: unknown): string {
  if (isAPIError(error) && error.body?.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
    return "An account with this email already exists. Log in instead.";
  }
  if (isAPIError(error) && error.body?.code === MEMBERSHIP_ERROR_CODES.inviteNotUsable) {
    return "This invite link has expired, was revoked, was already used, or is for a different email. Ask your team owner for a new one.";
  }
  logUnexpectedAuthError("signup", error);
  return "Could not create your account. Please try again.";
}

function getLoginErrorMessage(error: unknown): string {
  if (isAPIError(error) && error.status === "UNAUTHORIZED") {
    return "Email or password is incorrect.";
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
