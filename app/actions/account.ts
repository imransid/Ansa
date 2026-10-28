"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { withTypedValues, type FormErrors } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import { changeNameForSession, changePasswordForSession, signOutOtherDevicesForSession } from "@/services/account";

// Thin, like every action: the services validate and rate limit.

export type AccountFormState = {
  done?: boolean;
  errors?: FormErrors;
};

export async function changeNameAction(
  _previousState: AccountFormState | undefined,
  formData: FormData,
): Promise<AccountFormState> {
  const session = await requireSessionContext();
  const result = await changeNameForSession(session, { name: formData.get("name") });
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
  const result = await changePasswordForSession(
    session,
    {
      currentPassword: formData.get("currentPassword"),
      newPassword: formData.get("newPassword"),
    },
    await headers(),
  );
  if (!result.ok) {
    return { errors: result.errors };
  }
  // A redirect, not a refresh: Better Auth replaced this browser's login and
  // its cookie. A refresh in this same request would still read the old
  // cookie, whose login is gone, and send you to /login. The redirect's page
  // is rendered with the new cookie.
  redirect("/account?changed=password");
}

export async function signOutOtherDevicesAction(): Promise<AccountFormState> {
  const session = await requireSessionContext();
  const result = await signOutOtherDevicesForSession(session, await headers());
  if (!result.ok) {
    return { errors: result.errors };
  }
  revalidatePath("/account");
  return { done: true };
}
