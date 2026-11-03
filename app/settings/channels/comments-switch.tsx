"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { saveCommentSettingsAction } from "@/app/actions/comments";
import { SavedNote } from "@/components/saved-note";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

// "Answer comments on your posts" on Settings → Connections (owners): ticked
// and saved, ansa answers comments on the Facebook Page's posts.
export function CommentsSwitch({ on }: { on: boolean }) {
  const [state, saveAction, isSaving] = useActionState(saveCommentSettingsAction, undefined);
  // "Saved." is about the choice that was saved: ticking again hides it.
  const [changedSinceSave, setChangedSinceSave] = useState(false);
  const message = state?.errors?.message;

  // WHY by hand (as the support-trends setting does): when <form action>
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
        <Checkbox name="answerComments" defaultChecked={on} className="mt-0.5" />
        <span className="font-medium">Answer comments on your posts</span>
      </label>
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
