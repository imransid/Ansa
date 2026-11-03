"use client";

import { useActionState } from "react";
import { openBillingPortalAction } from "@/app/actions/billing";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { BillingView, SubscriptionSnapshot } from "@/lib/types/billing";
import { DemoControls } from "./demo-controls";
import { PackageCards } from "./package-cards";
import { UsageThisMonth } from "./usage-this-month";

// What the Billing page shows in each mode (Mode in core/internal/billing):
// the package the company has now and this month's use, then the packages
// to choose from (step 57). Development ("dev") has the demo's buttons
// instead of Stripe's page.
export function BillingPanel({ billing }: { billing: BillingView }) {
  return (
    <div className="grid gap-6">
      <UsageThisMonth billing={billing} />
      {billing.mode === "off" ? (
        <p className="max-w-xl text-sm">Payments aren&apos;t set up yet. There is nothing to pay or manage here for now.</p>
      ) : (
        <div className="grid max-w-xl gap-4">
          {billing.mode === "dev" && <DemoControls billing={billing} />}
          {billing.confirmingPayment && <p className="text-sm">Thanks! Stripe is confirming your payment. Reload this page in a few seconds.</p>}
          <SubscriptionStatus subscription={billing.subscription} />
          {billing.mode === "stripe" && <ManageBilling billing={billing} />}
        </div>
      )}
      <PackageCards billing={billing} />
    </div>
  );
}

function SubscriptionStatus({ subscription }: { subscription: SubscriptionSnapshot | null }) {
  if (!subscription) {
    return null;
  }
  const periodEnd = subscription.currentPeriodEnd ? <LocalDateTime iso={subscription.currentPeriodEnd.toISOString()} /> : null;
  return (
    <div className="grid gap-1 text-sm">
      <p className="flex items-center gap-2">
        Subscription <Badge variant={subscription.status === "active" ? "default" : "outline"}>{statusLabel(subscription.status)}</Badge>
      </p>
      {subscription.status === "past_due" && <p>The last payment failed. Update your card to keep your package.</p>}
      {periodEnd && subscription.status !== "canceled" && (
        <p className="text-muted-foreground">
          {subscription.cancelAtPeriodEnd ? "Ends on " : "Renews on "}
          {periodEnd}
        </p>
      )}
    </div>
  );
}

// Stripe's own page: change card or package, see invoices, cancel.
function ManageBilling({ billing }: { billing: BillingView }) {
  const [errors, action, isOpening] = useActionState(openBillingPortalAction, undefined);
  if (!billing.subscription) {
    return null;
  }
  return (
    <form action={action} className="grid justify-items-start gap-2">
      <Button type="submit" variant="outline" disabled={isOpening}>
        {isOpening ? "Opening Stripe..." : "Manage billing or change package"}
      </Button>
      {errors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {errors.message}
        </p>
      )}
    </form>
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
