"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { changeNameThroughCore, changePasswordThroughCore, logOutOtherDevicesThroughCore } from "@/lib/core-views/account";
import { withTypedValues, type FormErrors } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";

// Thin, like every action: core validates and rate limits.

export type AccountFormState = {
  done?: boolean;
  errors?: FormErrors;
};

export async function changeNameAction(
  _previousState: AccountFormState | undefined,
  formData: FormData,
): Promise<AccountFormState> {
  await requireSessionContext();
  const input = { name: formData.get("name") };
  const result = await changeNameThroughCore(input);
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
  await requireSessionContext();
  const input = {
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  };
  const result = await changePasswordThroughCore(input);
  if (!result.ok) {
    return { errors: result.errors };
  }
  // A redirect, not a refresh: core replaced this browser's login and its
  // cookie. A refresh in this same request would still read the old cookie,
  // whose login is gone, and send you to /login. The redirect's page is
  // rendered with the new cookie.
  redirect("/account?changed=password");
}

export async function signOutOtherDevicesAction(): Promise<AccountFormState> {
  await requireSessionContext();
  const result = await logOutOtherDevicesThroughCore();
  if (!result.ok) {
    return { errors: result.errors };
  }
  revalidatePath("/account");
  return { done: true };
}
