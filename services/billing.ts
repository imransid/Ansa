import "server-only";
import { getCompanyBilling, LIVE_SUBSCRIPTION_STATUSES, saveCompanySubscription, type SubscriptionSnapshot } from "@/db/billing";
import { createBillingPortalUrl, createCheckoutUrl } from "@/adapters/stripe";
import { env } from "@/lib/env";
import type { FormErrors, FormResult } from "@/lib/form-result";
import type { SessionContext } from "@/lib/session";
import { simulatedStatusSchema } from "@/lib/validation/billing";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

export type { SubscriptionSnapshot };

export type BillingView = {
  // "dev": Stripe is off; nothing can be charged, only simulated.
  mode: "stripe" | "dev";
  subscription: SubscriptionSnapshot | null;
  isLive: boolean;
};

export type RedirectResult = { ok: true; url: string } | { ok: false; errors: FormErrors };

const ownersOnly = { ok: false as const, errors: { message: "Only owners can manage billing." } };
const tooMany = { ok: false as const, errors: { message: "Too many attempts. Try again in a few minutes." } };

export function isStripeOn(): boolean {
  return env.USE_STRIPE === "true";
}

// The session company's billing state, for owners only (null for members).
export async function getBillingForSession(session: SessionContext): Promise<BillingView | null> {
  if (session.role !== "owner") {
    return null;
  }
  const subscription = (await getCompanyBilling(session.companyId)) ?? null;
  return {
    mode: isStripeOn() ? "stripe" : "dev",
    subscription,
    isLive: subscription !== null && LIVE_SUBSCRIPTION_STATUSES.includes(subscription.status),
  };
}

// A Stripe checkout link for the session's company. Owners only, and not while
// a subscription is still live (that would charge twice).
export async function startCheckoutForSession(session: SessionContext): Promise<RedirectResult> {
  const guard = await ownerGuard(session);
  if (guard) {
    return guard;
  }
  if (!isStripeOn()) {
    return { ok: false, errors: { message: "Payments are off (USE_STRIPE). Use the simulate buttons." } };
  }
  const current = await getCompanyBilling(session.companyId);
  if (current && LIVE_SUBSCRIPTION_STATUSES.includes(current.status)) {
    return { ok: false, errors: { message: "You already have a subscription. Use Manage billing." } };
  }
  const url = await createCheckoutUrl({
    companyId: session.companyId,
    ownerEmail: session.email,
    stripeCustomerId: current?.stripeCustomerId,
    successUrl: `${env.BETTER_AUTH_URL}/billing?checkout=done`,
    cancelUrl: `${env.BETTER_AUTH_URL}/billing`,
  });
  return { ok: true, url };
}

// A link to Stripe's billing portal for the session's company. Owners only.
export async function openBillingPortalForSession(session: SessionContext): Promise<RedirectResult> {
  const guard = await ownerGuard(session);
  if (guard) {
    return guard;
  }
  const current = await getCompanyBilling(session.companyId);
  if (!isStripeOn() || !current) {
    return { ok: false, errors: { message: "There is no subscription to manage yet." } };
  }
  return { ok: true, url: await createBillingPortalUrl(current.stripeCustomerId, `${env.BETTER_AUTH_URL}/billing`) };
}

// Dev stand-in: pretends Stripe reported this status, so every Billing page
// state can be tried locally. Refused when Stripe is on and in production.
export async function simulateSubscriptionForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const guard = await ownerGuard(session);
  if (guard) {
    return guard;
  }
  if (isStripeOn() || process.env.NODE_ENV === "production") {
    return { ok: false, errors: { message: "Simulating payments is only possible in development." } };
  }
  const parsed = simulatedStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "Unknown status." } };
  }
  const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await saveCompanySubscription(session.companyId, {
    stripeCustomerId: `dev_cus_${session.companyId}`,
    stripeSubscriptionId: `dev_sub_${session.companyId}`,
    status: parsed.data.status,
    currentPeriodEnd: parsed.data.status === "canceled" ? null : in30Days,
    cancelAtPeriodEnd: false,
  });
  return { ok: true };
}

async function ownerGuard(session: SessionContext): Promise<{ ok: false; errors: FormErrors } | null> {
  if (session.role !== "owner") {
    return ownersOnly;
  }
  if (await isOverRateLimit("billing", session.userId, RATE_LIMITS.billingActionsPerUser)) {
    return tooMany;
  }
  return null;
}
