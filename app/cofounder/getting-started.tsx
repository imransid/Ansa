import Link from "next/link";
import { Check } from "lucide-react";
import type { GettingStartedStep } from "@/lib/cofounder/getting-started";
import { cn } from "@/lib/utils";

// The Overview's checklist (step 43): each step from the interview to a
// post's numbers, done or not as the company's data says now, with what was
// found and a link to the page where it is done. The tick is only for the
// eye: "Done" or "To do" is read out with each step.
export function GettingStartedChecklist({ steps }: { steps: GettingStartedStep[] }) {
  const doneCount = steps.filter((step) => step.done).length;
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        {doneCount} of {steps.length} done.
      </p>
      <ol className="grid max-w-3xl gap-3">
        {steps.map((step) => (
          <li key={step.key} className="flex items-start gap-3 text-sm">
            <span
              aria-hidden
              className={cn(
                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                step.done ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40",
              )}
            >
              {step.done && <Check className="size-3.5" />}
            </span>
            <div className="grid min-w-0">
              <Link href={step.href} className="font-medium hover:underline">
                {step.label}
              </Link>
              <span className="text-muted-foreground">
                <span className="sr-only">{step.done ? "Done: " : "To do: "}</span>
                {step.status}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
