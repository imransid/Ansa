"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { withTypedValues, type FormErrors, type FormResult } from "@/lib/form-result";
import { KNOWN_DEVICE_COOKIE_NAME, knownDeviceCookieOptions } from "@/lib/known-device";
import { destinationAfterLogin } from "@/lib/login-redirect";
import { confirmEmailWithPassword, logIn, logOut } from "@/services/auth";
import {
  requestPasswordReset,
  resetPasswordWithToken,
  type ResetPasswordResult,
} from "@/services/password-reset";
import { signUpCompanyOwner } from "@/services/signup";

// Server actions are public POST endpoints. Keep them thin: read the form,
// call a service (which validates and rate limits), then redirect. A refused
// form gets back what was typed, never the password (withTypedValues).

// Given to the login services: after a login that worked they hand this
// browser a known-device cookie (lib/known-device.ts). Not exported, so it is
// not an action itself.
async function rememberThisBrowser(cookieValue: string): Promise<void> {
  (await cookies()).set(KNOWN_DEVICE_COOKIE_NAME, cookieValue, knownDeviceCookieOptions());
}

export async function signupAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const result = await signUpCompanyOwner(
    {
      companyName: formData.get("companyName"),
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password"),
    },
    await headers(),
  );
  if (!result.ok) {
    return withTypedValues(result.errors, formData, ["companyName", "name", "email"]);
  }
  // No session yet: the email address must be confirmed first (step 12).
  redirect("/check-email");
}

// next: the page the person wanted before they had to log in (the login form
// sends it along). Followed only when it is a path on this site
// (lib/login-redirect.ts), so the login page can't send anyone elsewhere.
export async function loginAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const result = await logIn(
    {
      email: formData.get("email"),
      password: formData.get("password"),
    },
    await headers(),
    rememberThisBrowser,
  );
  if (!result.ok) {
    return withTypedValues(result.errors, formData, ["email"]);
  }
  redirect(destinationAfterLogin(formData.get("next")));
}

export async function logoutAction(): Promise<void> {
  await logOut(await headers());
  redirect("/login");
}

// Called by the /verify-email page with the token from the link's "#" part
// and the password typed on the page. Returns instead of redirecting, so the
// page can show an error if the call itself fails.
export async function confirmEmailAction(formData: FormData): Promise<FormResult> {
  return confirmEmailWithPassword(
    {
      token: formData.get("token"),
      password: formData.get("password"),
    },
    await headers(),
    rememberThisBrowser,
  );
}

export type ForgotPasswordState = {
  sent?: boolean;
  errors?: FormErrors;
};

// The /forgot-password form. The reset email (if any) goes out after the
// response, through after(), so the answer takes as long for every address.
export async function requestPasswordResetAction(
  _previousState: ForgotPasswordState | undefined,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const result = await requestPasswordReset(
    { email: formData.get("email") },
    await headers(),
    (task) => after(task),
  );
  return result.ok ? { sent: true } : { errors: withTypedValues(result.errors, formData, ["email"]) };
}

// Called by the /reset-password page with the token from the link's "#" part
// and the new password. Returns instead of redirecting, like confirmEmailAction,
// because the page shows what happened (see ResetPasswordResult).
export async function resetPasswordAction(formData: FormData): Promise<ResetPasswordResult> {
  return resetPasswordWithToken(
    {
      token: formData.get("token"),
      newPassword: formData.get("newPassword"),
    },
    await headers(),
  );
}
