import "server-only";
import { isAPIError } from "better-auth/api";
import { z } from "zod";
import { auth } from "@/lib/auth";
import type { FormResult } from "@/lib/form-result";
import { hashInviteToken } from "@/lib/invite-token";
import { getClientIpFromHeaders } from "@/lib/request-ip";
import { signupSchema } from "@/lib/validation/auth";
import { joinWithInviteSchema } from "@/lib/validation/invites";
import { MEMBERSHIP_ERROR_CODES } from "./company-membership";
import { isInviteUsableForEmail } from "./invites";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Both forms answer an address that already has an account exactly like a new
// signup ("check your email"), and Better Auth emails that address instead
// (lib/auth.ts, onExistingUserSignUp). Neither gives a session: the address
// must be confirmed first (services/auth.ts, confirmEmailWithPassword).
// requestHeaders are the incoming request's headers: the IP is the rate
// limit key. They are passed in so the checks can call these too.

const tooManySignupsError: FormResult = {
  ok: false,
  errors: { message: "Too many signup attempts. Try again in an hour." },
};

const tooManyTriesWithThisInviteError: FormResult = {
  ok: false,
  errors: { message: "Too many tries with this invite link. Try again in an hour." },
};

const inviteNotUsableMessage =
  "This invite link has expired, was revoked, was already used, or is for a different email. Ask your team owner for a new one.";

// Creates a new company with the signing-up person as its owner.
export async function signUpCompanyOwner(input: unknown, requestHeaders: Headers): Promise<FormResult> {
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors },
    };
  }

  if (await isOverRateLimit("signup", getClientIpFromHeaders(requestHeaders), RATE_LIMITS.signupPerIp)) {
    return tooManySignupsError;
  }

  const { companyName, name, email, password } = parsed.data;
  // We never send companyId or role. The user-create hook in lib/auth.ts
  // reads companyName, creates the company, and sets both on the new user.
  // Better Auth passes extra body fields like companyName through at runtime,
  // but its types don't list them, so the body is built before the call.
  const signupBody = { name, email, password, companyName };
  try {
    await auth.api.signUpEmail({ body: signupBody, headers: requestHeaders });
  } catch (error) {
    return { ok: false, errors: { message: getSignupErrorMessage(error) } };
  }

  return { ok: true };
}

// Creates an account from an invite link, in the inviting company.
export async function joinCompanyWithInvite(input: unknown, requestHeaders: Headers): Promise<FormResult> {
  const parsed = joinWithInviteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: { fieldErrors: z.flattenError(parsed.error).fieldErrors },
    };
  }

  // Its own counter, not the signup one: a whole team may join from one
  // office IP on its first day.
  if (await isOverRateLimit("invite-join", getClientIpFromHeaders(requestHeaders), RATE_LIMITS.inviteJoinsPerIp)) {
    return tooManySignupsError;
  }
  const { inviteToken, name, email, password } = parsed.data;
  // And per invite link, wherever the tries come from. Keyed by the link's
  // hash, like the invites table, so the token itself is never stored.
  if (await isOverRateLimit("invite-join-link", hashInviteToken(inviteToken), RATE_LIMITS.inviteJoinsPerInvite)) {
    return tooManyTriesWithThisInviteError;
  }

  // Checked here, before Better Auth looks the email up. Better Auth answers
  // an existing address before the user-create hook ever sees the invite, so
  // without this a junk invite would say "not usable" for a new address but
  // "check your email" for one that has an account: the form would tell
  // anyone who has an account. The hook still claims the invite for real.
  if (!(await isInviteUsableForEmail(inviteToken, email))) {
    return { ok: false, errors: { message: inviteNotUsableMessage } };
  }

  // The user-create hook in lib/auth.ts sees inviteToken, checks the invite
  // matches this email, and takes company and role from the invite.
  const signupBody = { name, email, password, inviteToken };
  try {
    await auth.api.signUpEmail({ body: signupBody, headers: requestHeaders });
  } catch (error) {
    return { ok: false, errors: { message: getSignupErrorMessage(error) } };
  }

  return { ok: true };
}

// An address that already has an account never gets here: Better Auth answers
// it like a new signup (see the comment at the top).
function getSignupErrorMessage(error: unknown): string {
  if (isAPIError(error) && error.body?.code === MEMBERSHIP_ERROR_CODES.inviteNotUsable) {
    // The invite was used or revoked between our check and the claim.
    return inviteNotUsableMessage;
  }
  logUnexpectedSignupError(error);
  return "Could not create your account. Please try again.";
}

// Logs only the error type and status, never the request body,
// so passwords and emails can't end up in the logs.
function logUnexpectedSignupError(error: unknown): void {
  const status = isAPIError(error) ? error.status : "no status";
  const name = error instanceof Error ? error.name : typeof error;
  console.error(`Unexpected signup error: ${name} (${status})`);
}
