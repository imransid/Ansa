import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { lowestMonthlyPrice, WEBSITE_PACKAGES } from "@/lib/website-packages";
import { PackageList } from "./package-list";
import { PricingQuestions } from "./pricing-questions";

export const metadata: Metadata = {
  title: "Pricing - ansa",
  description: `Start with ${WEBSITE_PACKAGES.trialDays} days free, no card needed. Then from $${lowestMonthlyPrice()} a month.`,
};

// The website's Pricing page (step 58): the free trial and the three
// packages with the names, prices and limits core enforces (read from core's
// website.json: lib/website-packages.ts), what every package promises, and
// questions. Fully static, like the rest of the website.
export default function PricingPage() {
  return (
    <>
      <SiteHeader />
      <div className="mx-auto grid w-full max-w-6xl gap-16 px-6 py-16">
        <section className="grid max-w-2xl gap-4">
          <h1 className="font-display text-4xl leading-tight font-[340] tracking-[-0.03em] sm:text-5xl">Pricing</h1>
          <p className="text-lg text-muted-foreground">
            Start with {WEBSITE_PACKAGES.trialDays} days free, no card needed. Then choose the package that fits, from $
            {lowestMonthlyPrice()} a month.
          </p>
          <Link
            href="/signup"
            className="inline-flex h-12 items-center justify-self-start rounded-[14px] bg-primary bg-linear-to-b from-primary-highlight to-primary px-6 font-semibold text-primary-foreground shadow-button transition-transform hover:-translate-y-px"
          >
            Start free
          </Link>
        </section>
        <PackageList />
        <EveryPackage />
        <PricingQuestions />
      </div>
    </>
  );
}

const PROMISES = [
  {
    title: "Never silent at a limit.",
    text: "When a month's AI replies run out, people get your own holding reply and you get a note of what they wanted. Nothing extra is ever charged.",
  },
  { title: "Your own AI key, if you like.", text: "Replies written with your own Claude API key don't count against your package." },
  { title: "Change or cancel any time.", text: "On the Billing page. A package keeps working until the end of the month you paid for." },
];

// What holds for every package.
function EveryPackage() {
  return (
    <section aria-labelledby="every-package" className="grid gap-6">
      <h2 id="every-package" className="font-display text-3xl leading-tight font-[340] tracking-[-0.03em]">
        In every package
      </h2>
      <ul className="grid gap-x-10 sm:grid-cols-3">
        {PROMISES.map((promise) => (
          <li key={promise.title} className="grid content-start gap-1.5 border-t border-brass py-5">
            <h3 className="font-semibold">{promise.title}</h3>
            <p className="text-muted-foreground">{promise.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
