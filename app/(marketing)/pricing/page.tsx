import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Pricing - ansa", description: "One plan with everything included." };

// Pricing is not decided yet (CLAUDE.md, step 18). The amount lives on the
// Stripe price; when it is set, put it here too.
const included = [
  "AI voice agent on your support line",
  "Support emails turned into tickets",
  "Routing by category and workload",
  "Call transcripts and private recordings",
  "Your whole team, with owner and member roles",
  "Customer emails when a ticket is solved",
];

const questions = [
  {
    question: "When do I pay?",
    answer: "Only when you subscribe on the Billing page. You see the exact price on the payment page before anything is charged.",
  },
  {
    question: "Can I cancel?",
    answer: "Yes, at any time from the Billing page. Your plan keeps working until the end of the period you paid for.",
  },
  {
    question: "Who handles card details?",
    answer: "Stripe. Card numbers go straight to Stripe's own payment page and never reach our servers.",
  },
];

export default function PricingPage() {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-12 px-6 py-16">
      <section className="grid gap-4">
        <h1 className="text-4xl font-semibold tracking-tight">Pricing</h1>
        <p className="text-lg text-muted-foreground">One plan with everything included. We&apos;re finalising the price.</p>
      </section>

      <section className="grid gap-6 rounded-lg border p-8">
        <div className="grid gap-1">
          <h2 className="text-xl font-semibold">ansa</h2>
          <p className="text-muted-foreground">Price shown before you pay.</p>
        </div>
        <ul className="grid gap-2 text-sm">
          {included.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
        <Link href="/signup" className={buttonVariants({ size: "lg", className: "justify-self-start" })}>
          Get started
        </Link>
      </section>

      <section className="grid gap-6">
        <h2 className="text-xl font-semibold">Questions</h2>
        <dl className="grid gap-4">
          {questions.map((item) => (
            <div key={item.question} className="grid gap-1">
              <dt className="font-medium">{item.question}</dt>
              <dd className="text-sm text-muted-foreground">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
