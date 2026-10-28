"use client";

import { useActionState, useState } from "react";
import { saveMediaAltTextAction } from "@/app/actions/media";
import { SavedNote } from "@/components/saved-note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MEDIA_ALT_TEXT_MAX_LENGTH } from "@/lib/media/limits";

type AltTextFormProps = {
  assetId: string;
  current: string;
  // How many approved drafts use it: saving a change takes their approval away.
  approvedDrafts: number;
};

// What one image or video shows, for people who can't see it (step 39):
// an inline Save that says "Saved." when it worked, and keeps what was
// typed when it didn't. Published with the image once publishing exists,
// so a change is a new version of every draft using it.
export function AltTextForm({ assetId, current, approvedDrafts }: AltTextFormProps) {
  const [state, action, isSaving] = useActionState(saveMediaAltTextAction, undefined);
  // "Saved." is about the text that was saved: typing again hides it.
  const [changedSinceSave, setChangedSinceSave] = useState(false);
  const id = `alt-text-${assetId}`;
  const error = isSaving ? undefined : (state?.errors?.fieldErrors?.altText?.[0] ?? state?.errors?.message);
  return (
    <form action={action} onInput={() => setChangedSinceSave(true)} onSubmit={() => setChangedSinceSave(false)} className="grid gap-1">
      <input type="hidden" name="assetId" value={assetId} />
      <Label htmlFor={id} className="text-xs">
        What it shows (alt text)
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          name="altText"
          autoComplete="off"
          maxLength={MEDIA_ALT_TEXT_MAX_LENGTH}
          defaultValue={state?.errors?.values?.altText ?? current}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="min-w-0 flex-1"
        />
        <Button type="submit" size="sm" variant="outline" disabled={isSaving}>
          {isSaving ? "Saving..." : "Save"}
        </Button>
      </div>
      <SavedNote saved={state?.saved === true && !isSaving && !changedSinceSave} />
      {approvedDrafts > 0 && changedSinceSave && (
        <p className="text-xs">
          {approvedDrafts === 1
            ? "Saving a change makes the approved draft using it a draft again: an owner then approves it again."
            : "Saving a change makes the approved drafts using it drafts again: an owner then approves them again."}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
