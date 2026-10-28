import "server-only";
import { getCompanyBilling, LIVE_SUBSCRIPTION_STATUSES, saveCompanySubscription, type SubscriptionSnapshot } from "@/db/billing";
import { createBillingPortalUrl, createCheckoutUrl } from "@/adapters/stripe";
import { env } from "@/lib/env";
import type { FormErrors, FormResult } from "@/lib/form-result";
import { describeErrorWithFrames } from "@/lib/safe-error-logging";
import type { SessionContext } from "@/lib/session";
import { simulatedStatusSchema } from "@/lib/validation/billing";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

export type { SubscriptionSnapshot };

// "stripe": real payments (USE_STRIPE=true).
// "dev": Stripe is off on a developer's machine: nothing can be charged, and
//   the page offers buttons that pretend Stripe answered.
// "off": Stripe is off in production: the page only says billing isn't set up
//   yet. Owners can't change that, so they never see developer wording or
//   buttons that would always fail.
export type BillingMode = "stripe" | "dev" | "off";

export type BillingView = {
  mode: BillingMode;
  subscription: SubscriptionSnapshot | null;
  isLive: boolean;
  // Back from a paid checkout whose webhook hasn't been stored yet.
  confirmingPayment: boolean;
  // Subscribe is offered: no live subscription, and no payment being
  // confirmed (a second checkout then would charge twice).
  offersCheckout: boolean;
};

export type RedirectResult = { ok: true; url: string } | { ok: false; errors: FormErrors };

const ownersOnly = { ok: false as const, errors: { message: "Only owners can manage billing." } };
const tooMany = { ok: false as const, errors: { message: "Too many attempts. Try again in a few minutes." } };
const notSetUpYet = { ok: false as const, errors: { message: "Billing isn't set up yet." } };

// True when real payments are on (USE_STRIPE is exactly "true").
export function isStripeOn(): boolean {
  return env.USE_STRIPE === "true";
}

// Which billing the Billing page offers, from the USE_STRIPE setting and the
// NODE_ENV the server runs with. Takes both as arguments so the checks can try
// production without running in it.
export function billingModeFor(useStripe: string | undefined, nodeEnv: string | undefined): BillingMode {
  if (useStripe === "true") {
    return "stripe";
  }
  return nodeEnv === "production" ? "off" : "dev";
}

// The billing mode for this server's own settings (see billingModeFor).
function currentBillingMode(): BillingMode {
  return billingModeFor(env.USE_STRIPE, process.env.NODE_ENV);
}

// The session company's billing state, for owners only (null for members).
// justCheckedOut: the page was opened by Stripe's "payment done" redirect.
export async function getBillingForSession(session: SessionContext, justCheckedOut = false): Promise<BillingView | null> {
  if (session.role !== "owner") {
    return null;
  }
  const subscription = (await getCompanyBilling(session.companyId)) ?? null;
  const isLive = subscription !== null && LIVE_SUBSCRIPTION_STATUSES.includes(subscription.status);
  const confirmingPayment = justCheckedOut && !isLive;
  return { mode: currentBillingMode(), subscription, isLive, confirmingPayment, offersCheckout: !isLive && !confirmingPayment };
}

// A Stripe checkout link for the session's company. Owners only, and not while
// a subscription is still live (that would charge twice).
export async function startCheckoutForSession(session: SessionContext): Promise<RedirectResult> {
  const guard = await ownerGuard(session);
  if (guard) {
    return guard;
  }
  const mode = currentBillingMode();
  if (mode !== "stripe") {
    return mode === "dev" ? { ok: false, errors: { message: "Payments are off (USE_STRIPE). Use the simulate buttons." } } : notSetUpYet;
  }
  const current = await getCompanyBilling(session.companyId);
  if (current && LIVE_SUBSCRIPTION_STATUSES.includes(current.status)) {
    return { ok: false, errors: { message: "You already have a subscription. Use Manage billing." } };
  }
  return askStripeForPage("checkout", () =>
    createCheckoutUrl({
      companyId: session.companyId,
      ownerEmail: session.email,
      stripeCustomerId: current?.stripeCustomerId,
      successUrl: `${env.BETTER_AUTH_URL}/billing?checkout=done`,
      cancelUrl: `${env.BETTER_AUTH_URL}/billing`,
    }),
  );
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
  return askStripeForPage("portal", () => createBillingPortalUrl(current.stripeCustomerId, `${env.BETTER_AUTH_URL}/billing`));
}

// Asks Stripe for the address of one of its pages. Stripe being down, or a
// setting not done yet in Stripe's dashboard (the customer portal must be
// turned on), is a failure we expect: the owner gets a message and keeps the
// page instead of an error screen, and the log names the error's class,
// Stripe's code and the stack frames only (Stripe's messages can quote ids).
export async function askStripeForPage(page: "checkout" | "portal", getUrl: () => Promise<string>): Promise<RedirectResult> {
  try {
    return { ok: true, url: await getUrl() };
  } catch (error) {
    console.error(`Stripe ${page} failed: ${describeErrorWithFrames(error)}`);
    const what = page === "checkout" ? "the payment page" : "the billing page";
    return { ok: false, errors: { message: `Stripe could not open ${what} right now. Try again in a few minutes.` } };
  }
}

// Dev stand-in: pretends Stripe reported this status, so every Billing page
// state can be tried locally. Refused when Stripe is on and in production.
export async function simulateSubscriptionForSession(session: SessionContext, input: unknown): Promise<FormResult> {
  const guard = await ownerGuard(session);
  if (guard) {
    return guard;
  }
  if (currentBillingMode() !== "dev") {
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

// Refuses members, and counts one attempt against the owner's "billing" rate
// limit (so every call uses up a slot). Returns the refusal, or null to go on.
async function ownerGuard(session: SessionContext): Promise<{ ok: false; errors: FormErrors } | null> {
  if (session.role !== "owner") {
    return ownersOnly;
  }
  if (await isOverRateLimit("billing", session.userId, RATE_LIMITS.billingActionsPerUser)) {
    return tooMany;
  }
  return null;
}
