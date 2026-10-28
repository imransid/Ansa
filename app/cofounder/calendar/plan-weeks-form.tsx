"use client";

import { startTransition, useActionState, type SubmitEvent } from "react";
import { planCalendarAction } from "@/app/actions/publishing";
import { Button } from "@/components/ui/button";

// "Plan the next 2 weeks" (step 41, owners): the AI proposes posts from the
// current marketing plan's content pillars and how often to post, and each
// becomes an idea on the calendar (its topic, platform, day and time):
// nothing is written, approved or published. The days and times are the
// viewer's own: the browser names its timezone when the form is sent.
export function PlanWeeksForm() {
  const [result, formAction, isPending] = useActionState(planCalendarAction, undefined);

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
      <Button type="submit" className="justify-self-start" disabled={isPending}>
        {isPending ? "The AI is planning..." : "Plan the next 2 weeks"}
      </Button>
      {/* Always in the page, so screen readers announce what is put in it. */}
      <div role="status" className="text-sm">
        {isPending && <p className="text-muted-foreground">The AI is planning the next two weeks. This can take a minute or two.</p>}
        {!isPending && result?.ok && (
          <p className="rounded-lg border p-3">
            Added {result.added} {result.added === 1 ? "idea" : "ideas"} to the calendar below. Open one to write it (or let the AI write it),
            then an owner approves and schedules it.
          </p>
        )}
      </div>
      {!isPending && result && !result.ok && (
        <p role="alert" className="text-sm text-destructive wrap-anywhere">
          {result.errors.message}
        </p>
      )}
    </form>
  );
}
