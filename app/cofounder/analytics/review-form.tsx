"use client";

import { startTransition, useActionState, type SubmitEvent } from "react";
import { reviewPerformanceAction } from "@/app/actions/analytics";
import { Button } from "@/components/ui/button";
import type { AnalyticsPeriod } from "@/lib/analytics/kinds";

// "Review performance" (step 42, owners): the AI reads the period's post
// numbers and writes findings that cite them, and recommendations; only
// findings whose every number checks out are kept. The browser names its
// own timezone when the form is sent, so the review reads each post's
// weekday and hour as the owner lives them.
export function ReviewForm({ period, hasReview }: { period: AnalyticsPeriod; hasReview: boolean }) {
  const [result, formAction, isPending] = useActionState(reviewPerformanceAction, undefined);

  // WHY by hand: the timezone is only known in the browser, so it is added
  // here before the action runs. (`action` stays on the form, so a click
  // before the page has loaded sends no timezone, and the server says so.)
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("timeZone", Intl.DateTimeFormat().resolvedOptions().timeZone ?? "");
    startTransition(() => formAction(formData));
  }

  return (
    <form action={formAction} onSubmit={submit} className="grid gap-2">
      <input type="hidden" name="period" value={period} />
      <Button type="submit" className="justify-self-start" disabled={isPending}>
        {isPending ? "The AI is reviewing..." : hasReview ? "Review performance again" : "Review performance"}
      </Button>
      {/* Always in the page, so screen readers announce what is put in it. */}
      <div role="status" className="text-sm">
        {isPending && <p className="text-muted-foreground">The AI is reading the numbers of this period. This can take a minute or two.</p>}
        {!isPending && result?.ok && <p className="rounded-lg border p-3">The new review is ready below. The next marketing plan reads it as past performance.</p>}
      </div>
      {!isPending && result && !result.ok && (
        <p role="alert" className="text-sm text-destructive wrap-anywhere">
          {result.errors.message}
        </p>
      )}
    </form>
  );
}
