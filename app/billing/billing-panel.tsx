"use client";

import { useActionState } from "react";
import { openBillingPortalAction, simulateSubscriptionAction, startCheckoutAction } from "@/app/actions/billing";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BillingView, SubscriptionSnapshot } from "@/services/billing";

// What the Billing page shows in each mode (services/billing.ts, BillingMode).
export function BillingPanel({ billing }: { billing: BillingView }) {
  // Production with Stripe off: owners can't change that, so no developer
  // wording and no buttons that would always fail.
  if (billing.mode === "off") {
    return (
      <p className="max-w-xl text-sm">
        Billing isn&apos;t set up yet. There is nothing to pay or manage here for now.
      </p>
    );
  }
  return (
    <div className="grid max-w-xl gap-4">
      {billing.mode === "dev" && (
        <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
          Payments are off on this development server (USE_STRIPE is not true). Nothing can be charged; use the buttons
          below to try each state.
        </p>
      )}
      {billing.confirmingPayment && (
        <p className="text-sm">Thanks! Stripe is confirming your payment. Reload this page in a few seconds.</p>
      )}
      <SubscriptionStatus subscription={billing.subscription} />
      {billing.mode === "stripe" ? <StripeButtons billing={billing} /> : <SimulateButtons />}
    </div>
  );
}

function SubscriptionStatus({ subscription }: { subscription: SubscriptionSnapshot | null }) {
  if (!subscription) {
    return <p className="text-sm">No subscription yet.</p>;
  }
  const periodEnd = subscription.currentPeriodEnd ? <LocalDateTime iso={subscription.currentPeriodEnd.toISOString()} /> : null;
  return (
    <div className="grid gap-1 text-sm">
      <p className="flex items-center gap-2">
        Subscription <Badge variant={subscription.status === "active" ? "default" : "outline"}>{statusLabel(subscription.status)}</Badge>
      </p>
      {subscription.status === "past_due" && <p>The last payment failed. Update your card to keep your plan.</p>}
      {periodEnd && subscription.status !== "canceled" && (
        <p className="text-muted-foreground">
          {subscription.cancelAtPeriodEnd ? "Ends on " : "Renews on "}
          {periodEnd}
        </p>
      )}
    </div>
  );
}

function StripeButtons({ billing }: { billing: BillingView }) {
  const [checkoutErrors, checkoutAction, isStarting] = useActionState(startCheckoutAction, undefined);
  const [portalErrors, portalAction, isOpening] = useActionState(openBillingPortalAction, undefined);
  const message = checkoutErrors?.message ?? portalErrors?.message;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {billing.offersCheckout && (
        <form action={checkoutAction}>
          <Button type="submit" disabled={isStarting}>
            {isStarting ? "Opening Stripe..." : "Subscribe"}
          </Button>
        </form>
      )}
      {billing.subscription && (
        <form action={portalAction}>
          <Button type="submit" variant="outline" disabled={isOpening}>
            {isOpening ? "Opening Stripe..." : "Manage billing"}
          </Button>
        </form>
      )}
      {message && (
        <p role="alert" className="w-full text-sm text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}

function SimulateButtons() {
  const [errors, action, isSaving] = useActionState(simulateSubscriptionAction, undefined);
  const options = [
    { status: "active", label: "Simulate: subscribed" },
    { status: "past_due", label: "Simulate: payment failed" },
    { status: "canceled", label: "Simulate: canceled" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((option) => (
        <form key={option.status} action={action}>
          <input type="hidden" name="status" value={option.status} />
          <Button type="submit" variant="outline" size="sm" disabled={isSaving}>
            {option.label}
          </Button>
        </form>
      ))}
      {errors?.message && (
        <p role="alert" className="w-full text-sm text-destructive">
          {errors.message}
        </p>
      )}
    </div>
  );
}

function statusLabel(status: SubscriptionSnapshot["status"]): string {
  const labels: Record<SubscriptionSnapshot["status"], string> = {
    trialing: "trial",
    active: "active",
    past_due: "payment failed",
    unpaid: "unpaid",
    paused: "paused",
    incomplete: "not finished",
    incomplete_expired: "expired",
    canceled: "canceled",
  };
  return labels[status];
}
