import "server-only";
import { callCore, describeBrowser, setCoreCookies, type CoreCookie } from "@/lib/core-api";
import { toFormErrors } from "@/lib/core-views/auth";
import type { FormResult } from "@/lib/form-result";
import type { AccountDetails } from "@/services/account";

// The Account page through the new backend (core's /api/v1/account), in the
// shapes the page and its actions already read.

// A form value as the forms send it: text, or nothing.
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// Your name, your address, and how many browsers are logged in.
export async function getAccountFromCore(): Promise<AccountDetails> {
  const answer = await callCore<{ name: string; email: string; activeSessions: number }>("GET", "/api/v1/account");
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  return { name: answer.data.name, email: answer.data.email, activeSessionCount: answer.data.activeSessions };
}

export async function changeNameThroughCore(input: { name: unknown }): Promise<FormResult> {
  const answer = await callCore("POST", "/api/v1/account/name", { name: text(input.name) });
  return answer.ok ? { ok: true } : { ok: false, errors: toFormErrors(answer) };
}

// Every other login ends; this browser gets core's fresh session cookie.
export async function changePasswordThroughCore(input: { currentPassword: unknown; newPassword: unknown }): Promise<FormResult> {
  const answer = await callCore<{ cookies: CoreCookie[] }>("POST", "/api/v1/account/password", {
    currentPassword: text(input.currentPassword),
    newPassword: text(input.newPassword),
    ...(await describeBrowser()),
  });
  if (!answer.ok) {
    return { ok: false, errors: toFormErrors(answer) };
  }
  await setCoreCookies(answer.data.cookies);
  return { ok: true };
}

// "Log out on all other devices": this browser's login stays.
export async function logOutOtherDevicesThroughCore(): Promise<FormResult> {
  const answer = await callCore("POST", "/api/v1/account/logout-others");
  return answer.ok ? { ok: true } : { ok: false, errors: toFormErrors(answer) };
}
