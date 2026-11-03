"use client";

import { useActionState } from "react";
import { simulateSubscriptionAction, startCheckoutAction } from "@/app/actions/billing";
import { Button } from "@/components/ui/button";
import { packageLines } from "@/lib/packages";
import type { BillingView } from "@/lib/types/billing";
import type { AnsaPackage } from "@/lib/types/packages";

// The packages to choose from (step 57: their names, prices and limits come
// from core/internal/packages, the one place they live). With real
// payments a package is chosen on Stripe's page (or changed in "Manage
// billing" once paying); in development the button pretends Stripe answered.
export function PackageCards({ billing }: { billing: BillingView }) {
  const [checkoutErrors, checkout, isStarting] = useActionState(startCheckoutAction, undefined);
  const [simulateErrors, simulate, isSimulating] = useActionState(simulateSubscriptionAction, undefined);
  const message = checkoutErrors?.message ?? simulateErrors?.message;
  const current = billing.isLive ? billing.subscription?.package : undefined;
  return (
    <section aria-labelledby="packages-heading" className="grid gap-3">
      <h2 id="packages-heading" className="text-lg font-semibold">
        Packages
      </h2>
      <ul className="grid gap-4 md:grid-cols-3">
        {billing.packages.map((pkg) => (
          <li key={pkg.key} className="grid content-start gap-3 rounded-2xl border bg-card p-5">
            <div className="grid gap-0.5">
              <h3 className="font-semibold">{pkg.name}</h3>
              <p className="text-2xl font-semibold">
                ${pkg.priceUsd}
                <span className="text-sm font-normal text-muted-foreground"> a month</span>
              </p>
            </div>
            <ul className="grid gap-1 text-sm">
              {packageLines(pkg, "app").map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <ChooseButton
              pkg={pkg}
              billing={billing}
              current={current === pkg.key}
              checkout={checkout}
              simulate={simulate}
              busy={isStarting || isSimulating}
            />
          </li>
        ))}
      </ul>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </section>
  );
}

type ChooseProps = {
  pkg: AnsaPackage;
  billing: BillingView;
  current: boolean;
  checkout: (formData: FormData) => void;
  simulate: (formData: FormData) => void;
  busy: boolean;
};

function ChooseButton({ pkg, billing, current, checkout, simulate, busy }: ChooseProps) {
  if (current) {
    return <p className="text-sm font-medium text-link">Your package</p>;
  }
  if (billing.mode === "off") {
    return null;
  }
  if (billing.mode === "dev") {
    return (
      <form action={simulate}>
        <input type="hidden" name="status" value="active" />
        <input type="hidden" name="package" value={pkg.key} />
        <Button type="submit" variant="outline" size="sm" disabled={busy}>
          Simulate: choose {pkg.name}
        </Button>
      </form>
    );
  }
  if (!billing.offersCheckout) {
    return <p className="text-sm text-muted-foreground">Change to it in &ldquo;Manage billing&rdquo;.</p>;
  }
  return (
    <form action={checkout}>
      <input type="hidden" name="package" value={pkg.key} />
      <Button type="submit" disabled={busy}>
        {busy ? "Opening Stripe..." : `Choose ${pkg.name}`}
      </Button>
    </form>
  );
}
