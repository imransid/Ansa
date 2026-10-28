import type { ReactNode } from "react";
import Link from "next/link";
import type { FirstRunHints } from "@/services/dashboard";

// Points a new owner to the Setup steps still to do (until the company's
// first ticket, see services/dashboard.ts), and anyone who handles no
// category to the Team page, where they pick theirs (step 32): these are the
// two things that make tickets arrive and reach people.
export function FirstRunNotices({ hints }: { hints: FirstRunHints }) {
  const stepsLeft = hints.setupStepsLeft ?? 0;
  if (stepsLeft === 0 && !hints.handlesNoCategory) {
    return null;
  }
  return (
    <div className="grid gap-2">
      {stepsLeft > 0 && (
        <Notice>
          Setup isn&apos;t finished: {stepsLeft === 1 ? "1 step is" : `${stepsLeft} steps are`} still to do.{" "}
          <Link href="/setup" className="font-medium underline">
            Finish setting up
          </Link>
        </Notice>
      )}
      {hints.handlesNoCategory && (
        <Notice>
          You don&apos;t handle any category yet, so routing never gives you a ticket.{" "}
          <Link href="/team" className="font-medium underline">
            Pick the categories you handle
          </Link>
        </Notice>
      )}
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border bg-muted/40 p-3 text-sm">{children}</p>;
}
