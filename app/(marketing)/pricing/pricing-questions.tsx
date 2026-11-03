import { WEBSITE_PACKAGES } from "@/lib/website-packages";

const { trial, trialDays } = WEBSITE_PACKAGES;

// What people ask before they pay. Every number comes from core's packages
// (lib/website-packages.ts); every answer says only what ansa does today.
const QUESTIONS = [
  {
    question: "How does the free trial work?",
    answer: `For ${trialDays} days you get everything in Business, with ${trial.aiReplies} AI replies and ${trial.callMinutes} minutes of calls. No card needed. When it ends, choose a package on the Billing page to keep ansa answering with the AI.`,
  },
  {
    question: "What counts as an AI reply?",
    answer:
      "Each message ansa answers with the AI: a reply in a chat, an email it reads, a post it writes for you. Calls count in minutes instead. Replies written with your own Claude API key don't count.",
  },
  {
    question: "What happens when I reach a limit?",
    answer:
      "ansa never goes silent and never charges extra. Until the next month, or a bigger package, people get your own holding reply and you get a note of what they wanted.",
  },
  {
    question: "Can I change or cancel?",
    answer: "Yes, at any time on the Billing page. A package keeps working until the end of the month you paid for.",
  },
  {
    question: "Who handles card details?",
    answer: "Stripe. Card numbers go straight to Stripe's own payment page and never reach our servers.",
  },
];

export function PricingQuestions() {
  return (
    <section aria-labelledby="pricing-questions" className="grid max-w-3xl gap-6">
      <h2 id="pricing-questions" className="font-display text-3xl leading-tight font-[340] tracking-[-0.03em]">
        Questions
      </h2>
      <div className="divide-y border-y">
        {QUESTIONS.map((item) => (
          <details key={item.question} className="group py-1">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-sm py-4 text-lg font-semibold [&::-webkit-details-marker]:hidden">
              {item.question}
              <span aria-hidden className="font-display text-2xl text-link transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="max-w-[60ch] pb-5 text-muted-foreground">{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
