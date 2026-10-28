"use client";

import { startTransition, useActionState, useState, useSyncExternalStore, type SubmitEvent } from "react";
import { scheduleDraftAction } from "@/app/actions/publishing";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SCHEDULE_MAX_AHEAD_DAYS } from "@/lib/publishing/limits";
import { addDays, isKnownTimeZone, localDateOf, localTimeOf, wallClockToUtc } from "@/lib/publishing/schedule-time";
import type { PublishAccountChoice } from "@/services/draft-publishing";

type ScheduleFormProps = {
  draftId: string;
  // The saved version on screen: the one that is scheduled.
  version: number;
  accounts: PublishAccountChoice[];
  // Set when the draft has no approval but an auto-publish rule covers it:
  // the owner must tick that it goes out without one ("LinkedIn, every pillar").
  ruleLabel: string | null;
  // When the draft is planned for (ISO), offered as the time.
  plannedFor: string | null;
};

// "Schedule" on a draft's page (step 41, owners): the accounts it goes to,
// and now or a date and time. The date and time are typed in the viewer's
// own timezone and sent as one UTC instant made here (wallClockToUtc), so
// the server never guesses a timezone. Sent from onSubmit in a transition:
// React's reset after a <form action> would empty what was picked.
export function ScheduleForm({ draftId, version, accounts, ruleLabel, plannedFor }: ScheduleFormProps) {
  const [errors, formAction, isPending] = useActionState(scheduleDraftAction, undefined);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [timeProblem, setTimeProblem] = useState<string | null>(null);
  const shown = isPending ? undefined : errors;
  const timeError = timeProblem ?? shown?.fieldErrors?.scheduledFor?.[0];
  const accountsError = shown?.fieldErrors?.connectionIds?.[0];
  // null on the server and while the page wakes up (React's way to render
  // differently there without a mismatch), then the browser's own.
  const zone = useSyncExternalStore(subscribeToNothing, readBrowserTimeZone, () => null);
  const today = zone ? localDateOf(new Date(), zone) : "";

  // Picking "later" offers the planned time (if still ahead), else tomorrow at 09:00.
  function pickLater() {
    setWhen("later");
    if (date || !zone) {
      return;
    }
    const planned = plannedFor ? new Date(plannedFor) : null;
    const isPlannedAhead = planned !== null && planned.getTime() > Date.now();
    setDate(isPlannedAhead ? localDateOf(planned, zone) : addDays(today, 1));
    setTime(isPlannedAhead ? localTimeOf(planned, zone) : "09:00");
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("scheduledFor", "");
    if (when === "later") {
      const at = zone ? wallClockToUtc({ date, time }, zone) : null;
      if (!at) {
        setTimeProblem("Pick a date and a time.");
        return;
      }
      formData.set("scheduledFor", at.toISOString());
    }
    setTimeProblem(null);
    startTransition(() => formAction(formData));
  }

  return (
    <form action={formAction} onSubmit={submit} className="grid max-w-xl gap-4">
      <input type="hidden" name="draftId" value={draftId} />
      <input type="hidden" name="version" value={version} />
      <fieldset className="grid gap-2" aria-describedby={accountsError ? "schedule-accounts-error" : undefined}>
        <legend className="mb-1 text-sm font-medium">Accounts</legend>
        {accounts.map((account) => (
          <label key={account.id} className="flex items-start gap-2 text-sm">
            <Checkbox name="connectionId" value={account.id} className="mt-0.5" disabled={account.hasLiveJob || account.status !== "connected"} />
            <span className="wrap-anywhere">
              {account.displayName}
              {account.isStandIn && " (development stand-in: writes a file, publishes nothing)"}
              {account.hasLiveJob && " (scheduled, published or waiting for a check already)"}
              {account.status === "needs_reauth" && " (needs reconnecting on the Accounts page)"}
            </span>
          </label>
        ))}
        {accountsError && (
          <p id="schedule-accounts-error" role="alert" className="text-sm text-destructive">
            {accountsError}
          </p>
        )}
      </fieldset>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">When</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="when" value="now" checked={when === "now"} onChange={() => setWhen("now")} className="accent-primary" />
          Now
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="when" value="later" checked={when === "later"} onChange={pickLater} className="accent-primary" />
          At a date and time{zone ? ` (your time, ${zone})` : ""}
        </label>
        {when === "later" && (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1">
              <Label htmlFor="schedule-date">Date</Label>
              <Input
                id="schedule-date"
                type="date"
                required
                value={date}
                min={today}
                max={today ? addDays(today, SCHEDULE_MAX_AHEAD_DAYS) : undefined}
                onChange={(event) => setDate(event.target.value)}
                aria-invalid={timeError ? true : undefined}
                aria-describedby={timeError ? "schedule-time-error" : undefined}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="schedule-time">Time</Label>
              <Input
                id="schedule-time"
                type="time"
                required
                value={time}
                onChange={(event) => setTime(event.target.value)}
                aria-invalid={timeError ? true : undefined}
                aria-describedby={timeError ? "schedule-time-error" : undefined}
              />
            </div>
          </div>
        )}
        {timeError && (
          <p id="schedule-time-error" role="alert" className="text-sm text-destructive">
            {timeError}
          </p>
        )}
      </fieldset>
      {ruleLabel && (
        <label className="flex items-start gap-2 text-sm">
          <Checkbox name="withoutApproval" required className="mt-0.5" />
          <span>Send it without an owner&apos;s approval, under the auto-publish rule for {ruleLabel}.</span>
        </label>
      )}
      {shown?.message && (
        <p role="alert" className="text-sm text-destructive wrap-anywhere">
          {shown.message}
        </p>
      )}
      <Button type="submit" className="justify-self-start" disabled={isPending}>
        {isPending ? "Scheduling..." : when === "now" ? `Publish version ${version} now` : `Schedule version ${version}`}
      </Button>
    </form>
  );
}

// The browser's own timezone, or null when it names none this code knows.
function readBrowserTimeZone(): string | null {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone && isKnownTimeZone(zone) ? zone : null;
}

// Nothing changes after the page has loaded, so there is nothing to subscribe to.
function subscribeToNothing(): () => void {
  return () => {};
}
