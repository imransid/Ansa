import type { SubscriptionStatus } from "@/db/schema";
import type { FormErrors } from "@/lib/form-result";

// What the Billing page shows, and where its buttons send the browser.

export type SubscriptionSnapshot = {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

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
