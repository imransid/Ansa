"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isCoreOn } from "@/lib/core-api";
import { changeNameThroughCore, changePasswordThroughCore, logOutOtherDevicesThroughCore } from "@/lib/core-views/account";
import { withTypedValues, type FormErrors } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import { changeNameForSession, changePasswordForSession, signOutOtherDevicesForSession } from "@/services/account";

// Thin, like every action: the services validate and rate limit. Each uses
// the new backend when it is switched on (lib/core-api.ts), else services/;
// both answer in the same shapes.

export type AccountFormState = {
  done?: boolean;
  errors?: FormErrors;
};

export async function changeNameAction(
  _previousState: AccountFormState | undefined,
  formData: FormData,
): Promise<AccountFormState> {
  const session = await requireSessionContext();
  const input = { name: formData.get("name") };
  const result = isCoreOn() ? await changeNameThroughCore(input) : await changeNameForSession(session, input);
  if (!result.ok) {
    return { errors: withTypedValues(result.errors, formData, ["name"]) };
  }
  revalidatePath("/account");
  return { done: true };
}

export async function changePasswordAction(
  _previousState: AccountFormState | undefined,
  formData: FormData,
): Promise<AccountFormState> {
  const session = await requireSessionContext();
  const input = {
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  };
  const result = isCoreOn()
    ? await changePasswordThroughCore(input)
    : await changePasswordForSession(session, input, await headers());
  if (!result.ok) {
    return { errors: result.errors };
  }
  // A redirect, not a refresh: Better Auth (or core) replaced this browser's
  // login and its cookie. A refresh in this same request would still read
  // the old cookie, whose login is gone, and send you to /login. The
  // redirect's page is rendered with the new cookie.
  redirect("/account?changed=password");
}

export async function signOutOtherDevicesAction(): Promise<AccountFormState> {
  const session = await requireSessionContext();
  const result = isCoreOn() ? await logOutOtherDevicesThroughCore() : await signOutOtherDevicesForSession(session, await headers());
  if (!result.ok) {
    return { errors: result.errors };
  }
  revalidatePath("/account");
  return { done: true };
}
