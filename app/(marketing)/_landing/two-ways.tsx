import Link from "next/link";
import { Building2, Check, UserRound } from "lucide-react";

// "One assistant, two ways to use it" (2026-11-01): ansa for one person (a
// shadow while they're away) and for a business (a front desk that never
// closes), side by side, so every visitor finds themselves in one of them.
// Every point works today; the channels are named only in "Where it answers".
const WAYS = [
  {
    icon: UserRound,
    eyebrow: "For you",
    title: "Your shadow while you're away.",
    points: [
      "Answers while you sleep, travel, drive or work.",
      "Says it's your AI assistant. It never pretends to be you.",
      "Never agrees to a meeting, money or a decision for you: it takes a note.",
      "You choose when: your away hours, “I'm away”, or after 10 minutes without your answer.",
      "Wake up to “While you were away”, not 40 unread messages.",
    ],
    cta: "Set up ansa for me",
  },
  {
    icon: Building2,
    eyebrow: "For your business",
    title: "A front desk that never closes.",
    points: [
      "Answers customers from your prices, hours and notes, in seconds.",
      "Takes orders, with every total worked out by ansa, never by the AI.",
      "Complaints and refunds go straight to you, with a polite reply meanwhile.",
      "Hands each request to the right person on your team.",
      "One inbox for every conversation, request and order.",
    ],
    cta: "Set up ansa for my business",
  },
];

export function TwoWays() {
  return (
    <section className="bg-background">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 pt-20 pb-24 lg:pt-48">
        <div className="grid max-w-2xl gap-3">
          <h2 className="font-display text-4xl leading-tight font-[340] tracking-[-0.03em] sm:text-5xl">One assistant, two ways to use it.</h2>
          <p className="text-muted-foreground">Pick one when you sign up. You can change it later in Settings.</p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {WAYS.map((way) => (
            <article key={way.eyebrow} className="grid content-start gap-5 rounded-3xl border bg-card p-7 shadow-soft">
              <span className="flex items-center gap-2 text-sm font-semibold text-link">
                <way.icon aria-hidden className="size-4" />
                {way.eyebrow}
              </span>
              <h3 className="font-display text-3xl leading-tight font-[360]">{way.title}</h3>
              <ul className="grid gap-3">
                {way.points.map((point) => (
                  <li key={point} className="grid grid-cols-[auto_1fr] gap-2.5 text-[0.9375rem]">
                    <Check aria-hidden className="mt-0.5 size-4 text-link" />
                    {point}
                  </li>
                ))}
              </ul>
              <Link href="/signup" className="justify-self-start border-b border-link/40 pb-0.5 font-semibold text-link hover:border-link">
                {way.cta} &rarr;
              </Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
