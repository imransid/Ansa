"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { saveFollowPhoneAction } from "@/app/actions/devices";
import { FieldErrors } from "@/components/restaurant-setup/section-form";
import { SavedNote } from "@/components/saved-note";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { WAIT_MINUTES, waitInWords } from "@/lib/devices";
import type { WaitMinutes } from "@/lib/types/devices";

// "Answer for me when my phone is unreachable" (owners): the switch and how
// long no phone may go without checking in. Saved, it says "Saved." until
// something is changed again.
export function FollowPhoneForm({ followPhone, waitMinutes }: { followPhone: boolean; waitMinutes: WaitMinutes }) {
  const [state, saveAction, isSaving] = useActionState(saveFollowPhoneAction, undefined);
  // "Saved." is about the choice that was saved: changing it again hides it.
  const [changedSinceSave, setChangedSinceSave] = useState(false);
  const errors = state?.errors?.fieldErrors;
  const chosenWait = String(waitMinutes);

  // WHY by hand (as the comments switch does): when <form action> runs an
  // action, React resets the form afterwards, and after a refusal the box
  // and the menu would jump back to the saved choice. An action started
  // here, in a transition, runs without that reset.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChangedSinceSave(false);
    const formData = new FormData(event.currentTarget);
    startTransition(() => saveAction(formData));
  }

  return (
    <form action={saveAction} onSubmit={submit} onInput={() => setChangedSinceSave(true)} className="grid gap-4">
      {state?.errors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {state.errors.message}
        </p>
      )}
      <div className="grid gap-1">
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            name="followPhone"
            defaultChecked={followPhone}
            className="mt-0.5"
            aria-invalid={errors?.followPhone ? true : undefined}
            aria-describedby={errors?.followPhone ? "followPhone-errors" : undefined}
          />
          <span className="font-medium">Answer for me when my phone is unreachable</span>
        </label>
        <FieldErrors id="followPhone-errors" errors={errors?.followPhone} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="waitMinutes">When no phone has checked in for</Label>
        <NativeSelect
          id="waitMinutes"
          name="waitMinutes"
          key={chosenWait}
          defaultValue={chosenWait}
          className="justify-self-start"
          aria-invalid={errors?.waitMinutes ? true : undefined}
          aria-describedby={errors?.waitMinutes ? "waitMinutes-errors" : undefined}
        >
          {WAIT_MINUTES.map((minutes) => (
            <option key={minutes} value={String(minutes)}>
              {waitInWords(minutes)}
            </option>
          ))}
        </NativeSelect>
        <FieldErrors id="waitMinutes-errors" errors={errors?.waitMinutes} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" variant="outline" disabled={isSaving}>
          {isSaving ? "Saving..." : "Save"}
        </Button>
        <SavedNote saved={state?.saved === true && !isSaving && !changedSinceSave} />
      </div>
    </form>
  );
}
