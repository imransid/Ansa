import Link from "next/link";
import { Check } from "lucide-react";
import { packageLines } from "@/lib/packages";
import type { AnsaPackage } from "@/lib/types/packages";
import { channelIsOpen, channelsInWords } from "@/lib/website-channels";
import { WEBSITE_PACKAGES } from "@/lib/website-packages";

// Who each package is for, in a few words. Its name, price and limits come
// from core (lib/website-packages.ts).
const FOR_WHOM: Record<string, string> = {
  personal: "For one person.",
  business: "For a business and its team.",
  pro: "For a busy business.",
};

// The free trial, then the packages to choose, side by side.
export function PackageList() {
  const { trial, trialDays, paid } = WEBSITE_PACKAGES;
  const soon = channelsInWords("soon");
  return (
    <section aria-labelledby="packages" className="grid gap-6">
      <h2 id="packages" className="sr-only">
        Packages
      </h2>
      <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        <PackageCard
          name={trial.name}
          price={`$${trial.priceUsd}`}
          per={`for ${trialDays} days`}
          forWhom="Everything in Business, to try ansa."
          lines={[...packageLines(trial, "website"), "No card needed"]}
        />
        {paid.map((pkg: AnsaPackage) => (
          <PackageCard
            key={pkg.key}
            name={pkg.name}
            price={`$${pkg.priceUsd}`}
            per="a month"
            forWhom={FOR_WHOM[pkg.key] ?? ""}
            lines={packageLines(pkg, "website")}
          />
        ))}
      </ul>
      <p className="max-w-3xl text-sm text-muted-foreground">
        Prices are in US dollars. ansa answers on {channelsInWords("now")} today{soon ? `; ${soon} are coming soon` : ""}.
        {channelIsOpen("Phone calls") ? "" : " A package's call minutes count once phone calls are here."}
      </p>
    </section>
  );
}

type CardProps = { name: string; price: string; per: string; forWhom: string; lines: string[] };

function PackageCard({ name, price, per, forWhom, lines }: CardProps) {
  return (
    <li className="grid content-start gap-5 rounded-3xl border bg-card p-6 shadow-soft">
      <div className="grid gap-1">
        <h3 className="text-lg font-semibold">{name}</h3>
        <p className="text-sm text-muted-foreground">{forWhom}</p>
      </div>
      <p className="font-display text-4xl font-[360] tracking-[-0.02em]">
        {price}
        <span className="font-sans text-base font-normal tracking-normal text-muted-foreground"> {per}</span>
      </p>
      <ul className="grid gap-2.5">
        {lines.map((line) => (
          <li key={line} className="grid grid-cols-[auto_1fr] gap-2.5 text-[0.9375rem]">
            <Check aria-hidden className="mt-0.5 size-4 text-link" />
            {line}
          </li>
        ))}
      </ul>
      <Link href="/signup" className="justify-self-start border-b border-link/40 pb-0.5 font-semibold text-link hover:border-link">
        Start free &rarr;
      </Link>
    </li>
  );
}
