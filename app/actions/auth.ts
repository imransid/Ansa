"use server";

import { redirect } from "next/navigation";
import type { FormErrors, FormResult } from "@/lib/form-result";
import { logIn, logOut, signUpCompanyOwner, verifyEmailWithToken } from "@/services/auth";

// Server actions are public POST endpoints. Keep them thin: read the form,
// call a service (which validates and rate limits), then redirect.

export async function signupAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const result = await signUpCompanyOwner({
    companyName: formData.get("companyName"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!result.ok) {
    return result.errors;
  }
  // No session yet: the email address must be confirmed first (step 12).
  redirect("/check-email");
}

export async function loginAction(
  _previousErrors: FormErrors | undefined,
  formData: FormData,
): Promise<FormErrors | undefined> {
  const result = await logIn({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!result.ok) {
    return result.errors;
  }
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await logOut();
  redirect("/login");
}

// Called by the /verify-email page with the token from the link's "#" part.
export async function verifyEmailAction(token: string): Promise<FormResult> {
  return verifyEmailWithToken(token);
}
