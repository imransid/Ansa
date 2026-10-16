"use server";

import { redirect } from "next/navigation";
import type { FormErrors } from "@/lib/form-result";
import { logIn, logOut, signUpCompanyOwner } from "@/services/auth";

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
  redirect("/dashboard");
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
