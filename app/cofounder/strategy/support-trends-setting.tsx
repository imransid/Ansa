"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { setSupportTrendsAction } from "@/app/actions/marketing-strategy";
import { SavedNote } from "@/components/saved-note";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SUPPORT_TREND_DAYS } from "@/lib/marketing-plan/limits";

// Exactly what the setting shares, wherever it shows.
const WHAT_IT_SHARES = `When this is on, each new plan also gets how many support tickets each category had in the last ${SUPPORT_TREND_DAYS} days, such as "Billing: 12": category names and numbers only, never a ticket's subject, messages or customer details.`;

// The support-trends setting (step 37), off until an owner turns it on.
// Owners tick it and save; members see whether it is on. It changes what
// the NEXT plan reads, never a plan already made.
export function SupportTrendsSetting({ enabled, isOwner }: { enabled: boolean; isOwner: boolean }) {
  if (!isOwner) {
    return (
      <div className="grid gap-1 text-sm">
        <p>
          <span className="font-medium">Support trends:</span> {enabled ? "on" : "off"}. Only owners change it.
        </p>
        <p className="text-xs text-muted-foreground">{WHAT_IT_SHARES}</p>
      </div>
    );
  }
  return <SupportTrendsForm enabled={enabled} />;
}

function SupportTrendsForm({ enabled }: { enabled: boolean }) {
  const [state, saveAction, isSaving] = useActionState(setSupportTrendsAction, undefined);
  // "Saved." is about the choice that was saved: ticking again hides it.
  const [changedSinceSave, setChangedSinceSave] = useState(false);
  const message = state?.errors?.message;

  // WHY by hand (as on the Team page's category boxes): when <form action>
  // runs an action, React resets the form afterwards, and after a refusal
  // the box would jump back to the saved choice. An action started here,
  // in a transition, runs without that reset.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChangedSinceSave(false);
    const formData = new FormData(event.currentTarget);
    startTransition(() => saveAction(formData));
  }

  return (
    <form action={saveAction} onSubmit={submit} onInput={() => setChangedSinceSave(true)} className="grid gap-2">
      <label className="flex items-start gap-2 text-sm">
        <Checkbox name="useSupportTrends" defaultChecked={enabled} aria-describedby="support-trends-help" className="mt-0.5" />
        <span>Let new plans see how many support tickets each category had</span>
      </label>
      <p id="support-trends-help" className="text-xs text-muted-foreground">
        {WHAT_IT_SHARES}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="outline" disabled={isSaving}>
          {isSaving ? "Saving..." : "Save"}
        </Button>
        <SavedNote saved={state?.saved === true && !isSaving && !changedSinceSave} />
      </div>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </form>
  );
}
