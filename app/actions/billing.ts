"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormErrors } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import { openBillingPortalForSession, simulateSubscriptionForSession, startCheckoutForSession, type RedirectResult } from "@/services/billing";

// Thin, like every action: services/billing.ts checks owner role and rate limits.

export async function startCheckoutAction(): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  return goToStripeOrReturnErrors(await startCheckoutForSession(session));
}

export async function openBillingPortalAction(): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  return goToStripeOrReturnErrors(await openBillingPortalForSession(session));
}

export async function simulateSubscriptionAction(_previous: FormErrors | undefined, formData: FormData) {
  const session = await requireSessionContext();
  const result = await simulateSubscriptionForSession(session, { status: formData.get("status") });
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
