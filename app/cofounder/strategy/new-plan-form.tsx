"use client";

import { useActionState, useState } from "react";
import { makeMarketingPlanAction, type MarketingPlanState } from "@/app/actions/marketing-strategy";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { GOAL_NOTE_MAX_LENGTH } from "@/lib/marketing-plan/limits";

// "Make a new plan" (step 37, owners): an optional note on what the plan
// should focus on, then the AI writes it, which takes a few minutes. The
// note is kept in state, not left to the browser: React empties a form's
// own fields after every submit, and a note must not be lost to a refusal.
// It is emptied once a plan is saved, and can't be typed in while the AI
// writes.
export function NewPlanForm({ hasPlan }: { hasPlan: boolean }) {
  const [goalNote, setGoalNote] = useState("");

  async function makePlan(previous: MarketingPlanState | undefined, formData: FormData): Promise<MarketingPlanState> {
    const state = await makeMarketingPlanAction(previous, formData);
    if (state.result?.ok) {
      setGoalNote("");
    }
    return state;
  }

  const [state, formAction, isWriting] = useActionState(makePlan, undefined);
  const result = state?.result;
  // As with the "ready" notice below, only the last try's outcome shows,
  // and not while a new one runs.
  const errors = !isWriting && result && !result.ok ? result.errors : undefined;
  // Only the note's own problem marks the box. The rest (the AI, the hourly
  // limit, missing facts) is about the plan, not about what was typed.
  const noteError = errors?.fieldErrors?.goalNote?.[0];
  const message = errors?.message;

  return (
    <form action={formAction} className="grid gap-2">
      <Label htmlFor="goal-note">What should the plan focus on? (optional)</Label>
      <Textarea
        id="goal-note"
        name="goalNote"
        rows={3}
        maxLength={GOAL_NOTE_MAX_LENGTH}
        readOnly={isWriting}
        value={goalNote}
        onChange={(event) => setGoalNote(event.target.value)}
        aria-describedby={noteError ? "goal-note-help goal-note-error" : "goal-note-help"}
        aria-invalid={noteError ? true : undefined}
      />
      <p id="goal-note-help" className="text-xs text-muted-foreground">
        For example &ldquo;more weekday lunch bookings&rdquo; or &ldquo;launch our new catering service&rdquo;. Kept with
        the plan as plain text and read by the AI: leave out your customers&apos; details.
      </p>
      {noteError && (
        <p id="goal-note-error" role="alert" className="text-sm text-destructive">
          {noteError}
        </p>
      )}
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      {/* Always in the page, so screen readers announce what is put in it. */}
      <div role="status" className="text-sm">
        {isWriting && <p className="text-muted-foreground">The Co-Founder is writing the plan. This can take a few minutes.</p>}
        {!isWriting && result?.ok && (
          <p className="rounded-lg border p-3">
            Version {result.version} is ready: it is now the{" "}
            <a href="#plan-title" className="underline">
              current plan
            </a>
            .
          </p>
        )}
      </div>
      <Button type="submit" className="justify-self-start" disabled={isWriting}>
        {isWriting ? "Writing the plan..." : hasPlan ? "Make a new plan" : "Make the first plan"}
      </Button>
    </form>
  );
}
