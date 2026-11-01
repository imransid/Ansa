import "server-only";
import { callCore } from "@/lib/core-api";
import type { FormResult } from "@/lib/form-result";
import type { BillingView, RedirectResult, SubscriptionSnapshot } from "@/lib/types/billing";

// The Billing page through the new backend (core's /api/v1/billing), in the
// shapes the page and its actions already read.

type CoreSubscription = Pick<SubscriptionSnapshot, "status" | "cancelAtPeriodEnd"> & { currentPeriodEnd: string | null };
type CoreBillingView = Omit<BillingView, "subscription"> & { subscription: CoreSubscription | null };

// Core never sends Stripe's ids to the screens, and the page shows neither,
// so they stay empty here.
function toSubscriptionSnapshot(subscription: CoreSubscription): SubscriptionSnapshot {
  return {
    stripeCustomerId: "",
    stripeSubscriptionId: "",
    status: subscription.status,
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
  return { ...billing, subscription: billing.subscription ? toSubscriptionSnapshot(billing.subscription) : null };
}

// The address of Stripe's payment page ("checkout") or billing page ("portal").
export async function askCoreForStripePage(page: "checkout" | "portal"): Promise<RedirectResult> {
  const answer = await callCore<{ url: string }>("POST", `/api/v1/billing/${page}`);
  return answer.ok ? { ok: true, url: answer.data.url } : { ok: false, errors: { message: answer.message } };
}

// Development stand-in: pretends Stripe reported this status.
export async function simulateSubscriptionThroughCore(input: { status: unknown }): Promise<FormResult> {
  const status = typeof input.status === "string" ? input.status : "";
  const answer = await callCore("POST", "/api/v1/billing/simulate", { status });
  return answer.ok ? { ok: true } : { ok: false, errors: { message: answer.message } };
}
