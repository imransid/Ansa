"use client";

import { simulateDemoStepAction, simulateSubscriptionAction } from "@/app/actions/billing";
import { ActionButton } from "@/components/action-button";
import type { BillingDemoStep, BillingView } from "@/lib/types/billing";

// Billing in "dev" mode (a developer's machine, or the demo on this laptop):
// nothing can be charged, and these buttons pretend time passed or Stripe
// answered, so a demo can show the free trial ending, a month's limits
// running out and a payment's life, then put it all back (core refuses
// them anywhere else). Each shows only while it would change something.
export function DemoControls({ billing }: { billing: BillingView }) {
  const { package: pkg, usage, subscription } = billing;
  const live = billing.isLive ? subscription : null;
  const paymentFailed = live?.status === "past_due" || live?.status === "unpaid";
  return (
    <div className="grid gap-3 rounded-md border border-dashed px-3 py-3">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Demo payments: nothing is charged.</span> These buttons show what happens when the free
        trial ends, a month&apos;s limit runs out or a payment fails, and &ldquo;back to normal&rdquo; puts it all back.
      </p>
      <div className="flex flex-wrap items-start gap-2">
        {pkg.key === "trial" && <DemoStep step="trial_ended" label="Simulate: trial ended" />}
        {pkg.key !== "none" && usage.aiReplies < pkg.aiReplies && <DemoStep step="ai_replies_used_up" label="Simulate: AI replies used up" />}
        {pkg.key !== "none" && usage.callSeconds < pkg.callMinutes * 60 && (
          <DemoStep step="call_minutes_used_up" label="Simulate: call minutes used up" />
        )}
        {live && !paymentFailed && <StripeSays status="past_due" packageKey={live.package} label="Simulate: payment failed" />}
        {paymentFailed && <DemoStep step="payment_fixed" label="Simulate: payment fixed" />}
        {live && !live.cancelAtPeriodEnd && <DemoStep step="cancel_at_period_end" label="Simulate: cancel at the end of the period" />}
        {live && <StripeSays status="canceled" packageKey={live.package} label="Simulate: canceled" />}
        <DemoStep step="back_to_normal" label="Simulate: back to normal" />
      </div>
    </div>
  );
}

function DemoStep({ step, label }: { step: BillingDemoStep; label: string }) {
  return <ActionButton action={simulateDemoStepAction} fields={{ step }} label={label} accessibleLabel={label} />;
}

// What Stripe could report about the package being paid.
function StripeSays({ status, packageKey, label }: { status: "past_due" | "canceled"; packageKey: string; label: string }) {
  return <ActionButton action={simulateSubscriptionAction} fields={{ status, package: packageKey }} label={label} accessibleLabel={label} />;
}
