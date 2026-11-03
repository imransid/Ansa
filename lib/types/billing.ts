import type { SubscriptionStatus } from "@/db/schema";
import type { FormErrors } from "@/lib/form-result";
import type { AnsaPackage, PackageUsage } from "@/lib/types/packages";

// What the Billing page shows, and where its buttons send the browser.

export type SubscriptionSnapshot = {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: SubscriptionStatus;
  // The package the subscription's price is (step 57).
  package: "personal" | "business" | "pro";
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
  // Step 57: the package the company has now (the trial, a paid one, or
  // none), the paid ones it can choose, when the trial ends, this month's use.
  package: AnsaPackage;
  packages: AnsaPackage[];
  trialEndsAt: Date;
  usage: PackageUsage;
};

export type RedirectResult = { ok: true; url: string } | { ok: false; errors: FormErrors };
