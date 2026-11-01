"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isCoreOn } from "@/lib/core-api";
import { askCoreForStripePage, simulateSubscriptionThroughCore } from "@/lib/core-views/billing";
import type { FormErrors } from "@/lib/form-result";
import { requireSessionContext } from "@/lib/session";
import type { RedirectResult } from "@/lib/types/billing";
import { openBillingPortalForSession, simulateSubscriptionForSession, startCheckoutForSession } from "@/services/billing";

// Thin, like every action: services/billing.ts checks owner role and rate limits.
// Each uses the new backend when it is switched on (lib/core-api.ts), else
// services/; both answer in the same shapes.

export async function startCheckoutAction(): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  return goToStripeOrReturnErrors(isCoreOn() ? await askCoreForStripePage("checkout") : await startCheckoutForSession(session));
}

export async function openBillingPortalAction(): Promise<FormErrors | undefined> {
  const session = await requireSessionContext();
  return goToStripeOrReturnErrors(isCoreOn() ? await askCoreForStripePage("portal") : await openBillingPortalForSession(session));
}

export async function simulateSubscriptionAction(_previous: FormErrors | undefined, formData: FormData) {
  const session = await requireSessionContext();
  const input = { status: formData.get("status") };
  const result = isCoreOn() ? await simulateSubscriptionThroughCore(input) : await simulateSubscriptionForSession(session, input);
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
