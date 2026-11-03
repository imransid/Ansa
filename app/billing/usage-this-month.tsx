import { LocalDateTime } from "@/components/local-date-time";
import { callMinutesUsed, daysLeftWords, trialDaysLeft } from "@/lib/packages";
import type { BillingView } from "@/lib/types/billing";

// The package the company has now and what it used this month (step 57):
// the free trial's days, or that it ended; AI replies and call minutes.
export function UsageThisMonth({ billing }: { billing: BillingView }) {
  const { package: pkg, usage } = billing;
  const status = { package: pkg, trialEndsAt: billing.trialEndsAt, usage };
  return (
    <section aria-labelledby="your-package-heading" className="grid max-w-xl gap-3 rounded-2xl border bg-card p-5">
      <h2 id="your-package-heading" className="text-lg font-semibold">
        {pkg.key === "none" ? "No package" : `Your package: ${pkg.name}`}
      </h2>
      <PackageLine billing={billing} />
      {pkg.key !== "none" && (
        <div className="grid gap-3">
          <Meter label="AI replies this month" used={usage.aiReplies} limit={pkg.aiReplies} />
          <Meter label="Call minutes this month" used={callMinutesUsed(status)} limit={pkg.callMinutes} />
          <p className="text-xs text-muted-foreground">
            Counted from the 1st of each month (UTC). Replies written with your own Claude key (Settings → Assistant) aren&apos;t counted.
          </p>
        </div>
      )}
    </section>
  );
}

function PackageLine({ billing }: { billing: BillingView }) {
  const { package: pkg } = billing;
  if (pkg.key === "none") {
    return (
      <p className="text-sm">
        Your free trial has ended. ansa still receives every message and sends your holding reply, but doesn&apos;t answer with the AI
        until you choose a package below.
      </p>
    );
  }
  if (pkg.key === "trial") {
    const days = trialDaysLeft(billing.trialEndsAt, new Date());
    return (
      <p className="text-sm">
        Free until <LocalDateTime iso={billing.trialEndsAt.toISOString()} /> ({daysLeftWords(days)}), no card needed. Choose a package below
        to keep ansa answering after that.
      </p>
    );
  }
  return <p className="text-sm">${pkg.priceUsd} a month.</p>;
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const share = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  const full = used >= limit;
  return (
    <div className="grid gap-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className={full ? "font-medium text-destructive" : "text-muted-foreground"}>
          {used.toLocaleString("en")} of {limit.toLocaleString("en")}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={label} aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit}>
        <div className={full ? "h-full bg-destructive" : "h-full bg-primary"} style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}
