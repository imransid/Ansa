import "server-only";
import { callCore, describeBrowser, setCoreCookies, type CoreCookie } from "@/lib/core-api";
import type { FormErrors, FormResult } from "@/lib/form-result";
import type { InvitePreviewResult } from "@/lib/types/invites";
import type { ResetPasswordResult } from "@/lib/types/password-reset";

// The login pages through the new backend (core's /api/v1/auth/*), answering
// in the shapes the old services answered, so the actions and pages stay the
// same. Nobody is logged in yet: every body also carries what the screens
// saw of the browser (describeBrowser), which core's limits need.

// A form value as the forms send it: text, or nothing.
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// Core's refusal as a form's errors: a problem under each field it names,
// else its one message at the top of the form.
export function toFormErrors(refusal: { message: string; fields: Record<string, string> }): FormErrors {
  const fieldNames = Object.keys(refusal.fields);
  if (fieldNames.length === 0) {
    return { message: refusal.message };
  }
  const fieldErrors: Record<string, string[]> = {};
  for (const name of fieldNames) {
    fieldErrors[name] = [refusal.fields[name]];
  }
  return { fieldErrors };
}

// Signup: "check your email" for every address (an existing one is told by email).
export async function signUpThroughCore(input: { name: unknown; email: unknown; password: unknown }): Promise<FormResult> {
  const answer = await callCore("POST", "/api/v1/auth/signup", {
    name: text(input.name),
    email: text(input.email),
    password: text(input.password),
    ...(await describeBrowser()),
  });
  return answer.ok ? { ok: true } : { ok: false, errors: toFormErrors(answer) };
}

// Joining a team through an invite link: "check your email", like signup.
export async function joinThroughCore(input: { inviteToken: unknown; name: unknown; email: unknown; password: unknown }): Promise<FormResult> {
  const answer = await callCore("POST", "/api/v1/auth/join", {
    inviteToken: text(input.inviteToken),
    name: text(input.name),
    email: text(input.email),
    password: text(input.password),
    ...(await describeBrowser()),
  });
  return answer.ok ? { ok: true } : { ok: false, errors: toFormErrors(answer) };
}

// Who an invite link is for (the join page shows it before the form).
export async function getInvitePreviewFromCore(inviteToken: unknown): Promise<InvitePreviewResult> {
  const answer = await callCore<InvitePreviewResult>("POST", "/api/v1/auth/invite-preview", {
    inviteToken: text(inviteToken),
    ...(await describeBrowser()),
  });
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  return answer.data;
}

// Login: on success this browser gets core's session and known-device cookies.
export async function logInThroughCore(input: { email: unknown; password: unknown }): Promise<FormResult> {
  return openSessionThroughCore("/api/v1/auth/login", { email: text(input.email), password: text(input.password) });
}

// Confirming an address: the link's token AND the password; it logs in too.
export async function confirmEmailThroughCore(input: { token: unknown; password: unknown }): Promise<FormResult> {
  return openSessionThroughCore("/api/v1/auth/confirm", { token: text(input.token), password: text(input.password) });
}

async function openSessionThroughCore(path: string, fields: Record<string, string>): Promise<FormResult> {
  const answer = await callCore<{ cookies: CoreCookie[] }>("POST", path, { ...fields, ...(await describeBrowser()) });
  if (!answer.ok) {
    return { ok: false, errors: toFormErrors(answer) };
  }
  await setCoreCookies(answer.data.cookies);
  return { ok: true };
}

// Logout: ends this login (if core still has it) and clears its cookie,
// which core answers either way.
export async function logOutThroughCore(): Promise<void> {
  const answer = await callCore<{ cookies: CoreCookie[] }>("POST", "/api/v1/auth/logout");
  if (answer.ok) {
    await setCoreCookies(answer.data.cookies);
  }
}

// Asking for a reset link: the same answer for every address.
export async function requestPasswordResetThroughCore(input: { email: unknown }): Promise<FormResult> {
  const answer = await callCore("POST", "/api/v1/auth/reset-request", { email: text(input.email), ...(await describeBrowser()) });
  return answer.ok ? { ok: true } : { ok: false, errors: toFormErrors(answer) };
}

// Using a reset link: a new password, or (an unconfirmed invitee's account)
// the account removed.
export async function resetPasswordThroughCore(input: { token: unknown; newPassword: unknown }): Promise<ResetPasswordResult> {
  const answer = await callCore<{ outcome: "password-changed" | "account-removed" }>("POST", "/api/v1/auth/reset", {
    token: text(input.token),
    newPassword: text(input.newPassword),
    ...(await describeBrowser()),
  });
  return answer.ok ? { ok: true, outcome: answer.data.outcome } : { ok: false, errors: toFormErrors(answer) };
}
