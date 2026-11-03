"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { askCoreForStripePage, simulateSubscriptionThroughCore } from "@/lib/core-views/billing";
import type { FormErrors } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import type { RedirectResult } from "@/lib/types/billing";

// Thin, like every action: core checks owner role and rate limits
// (core/internal/api).

// The package comes from the button pressed; core checks it is one of ansa's.
export async function startCheckoutAction(_previous: FormErrors | undefined, formData: FormData): Promise<FormErrors | undefined> {
  await requireSessionContext();
  const packageKey = formData.get("package");
  return goToStripeOrReturnErrors(await askCoreForStripePage("checkout", typeof packageKey === "string" ? packageKey : ""));
}

export async function openBillingPortalAction(): Promise<FormErrors | undefined> {
  await requireSessionContext();
  return goToStripeOrReturnErrors(await askCoreForStripePage("portal"));
}

export async function simulateSubscriptionAction(_previous: FormErrors | undefined, formData: FormData) {
  await requireSessionContext();
  const input = { status: formData.get("status"), package: formData.get("package") };
  const result = await simulateSubscriptionThroughCore(input);
  if (!result.ok) {
    return result.errors;
  }
  revalidatePath("/billing");
  return undefined;
}

function goToStripeOrReturnErrors(result: RedirectResult): FormErrors | undefined {
  if (!result.ok) {
    return result.errors;
  }
  // redirect() works by throwing, so this must never sit inside a try/catch.
  redirect(result.url);
}
