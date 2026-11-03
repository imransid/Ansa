import "server-only";
import { callCore } from "@/lib/core-api";
import type { FormResult } from "@/lib/form-result";
import type { BillingView, RedirectResult, SubscriptionSnapshot } from "@/lib/types/billing";

// The Billing page through the new backend (core's /api/v1/billing), in the
// shapes the page and its actions already read.

type CoreSubscription = Pick<SubscriptionSnapshot, "status" | "cancelAtPeriodEnd" | "package"> & { currentPeriodEnd: string | null };
type CoreBillingView = Omit<BillingView, "subscription" | "trialEndsAt"> & { subscription: CoreSubscription | null; trialEndsAt: string };

// Core never sends Stripe's ids to the screens, and the page shows neither,
// so they stay empty here.
function toSubscriptionSnapshot(subscription: CoreSubscription): SubscriptionSnapshot {
  return {
    stripeCustomerId: "",
    stripeSubscriptionId: "",
    status: subscription.status,
    package: subscription.package,
    currentPeriodEnd: subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
  };
}

// The company's billing for owners; null for members (core answers null).
// justCheckedOut: the page was opened by Stripe's "payment done" redirect.
export async function getBillingFromCore(justCheckedOut: boolean): Promise<BillingView | null> {
  const path = justCheckedOut ? "/api/v1/billing?checkout=done" : "/api/v1/billing";
  const answer = await callCore<{ billing: CoreBillingView | null }>("GET", path);
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  const billing = answer.data.billing;
  if (!billing) {
    return null;
  }
  return {
    ...billing,
    subscription: billing.subscription ? toSubscriptionSnapshot(billing.subscription) : null,
    trialEndsAt: new Date(billing.trialEndsAt),
  };
}

// The address of Stripe's payment page for a package ("checkout") or its
// billing page ("portal": card, invoices, changing package, cancelling).
export async function askCoreForStripePage(page: "checkout" | "portal", packageKey = ""): Promise<RedirectResult> {
  const answer = await callCore<{ url: string }>("POST", `/api/v1/billing/${page}`, page === "checkout" ? { package: packageKey } : undefined);
  return answer.ok ? { ok: true, url: answer.data.url } : { ok: false, errors: { message: answer.message } };
}

// Development stand-in: pretends Stripe reported this status for a package.
export async function simulateSubscriptionThroughCore(input: { status: unknown; package: unknown }): Promise<FormResult> {
  const status = typeof input.status === "string" ? input.status : "";
  const packageKey = typeof input.package === "string" ? input.package : "";
  const answer = await callCore("POST", "/api/v1/billing/simulate", { status, package: packageKey });
  return answer.ok ? { ok: true } : { ok: false, errors: { message: answer.message } };
}

// Development stand-in: one demo step (the trial ended, a month's limit used
// up, a failed payment fixed, a cancel at the period's end, back to normal).
// Core checks the step is one of its own.
export async function simulateDemoStepThroughCore(step: unknown): Promise<FormResult> {
  const answer = await callCore("POST", "/api/v1/billing/demo", { step: typeof step === "string" ? step : "" });
  return answer.ok ? { ok: true } : { ok: false, errors: { message: answer.message } };
}
