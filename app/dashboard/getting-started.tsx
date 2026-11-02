import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";
import type { GettingStartedStep } from "@/lib/types/home";

// Home's "Getting started" (the "easy to use" pass of 2026-11-01): the few
// things that make ansa answer at all, each a link to the one page that does
// it, ticked once done. Gone once every one is (core/internal/home).
export function GettingStarted({ steps }: { steps: GettingStartedStep[] }) {
  if (steps.length === 0) {
    return null;
  }
  const done = steps.filter((step) => step.done).length;
  return (
    <section aria-labelledby="getting-started-heading" className="grid gap-3 rounded-2xl border bg-card p-5">
      <div className="grid gap-1">
        <h2 id="getting-started-heading" className="text-lg font-semibold">
          Getting started
        </h2>
        <p className="text-sm text-muted-foreground">
          {done} of {steps.length} done. ansa answers people once these are.
        </p>
      </div>
      <ol className="divide-y border-y">
        {steps.map((step, index) => (
          <li key={step.key}>
            {step.done ? (
              <p className="flex min-h-12 items-center gap-3 py-2 text-sm text-muted-foreground">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-success-surface text-success">
                  <Check aria-hidden className="size-3.5" />
                </span>
                <span>
                  <span className="sr-only">Done: </span>
                  {step.doneText}
                </span>
              </p>
            ) : (
              <Link href={step.href} className="flex min-h-12 items-center gap-3 py-2 text-sm font-medium hover:text-link">
                <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full border text-xs numbers">
                  {index + 1}
                </span>
                <span className="flex-1">{step.label}</span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
