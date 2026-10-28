"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { saveFactAction } from "@/app/actions/cofounder";
import { SavedNote } from "@/components/saved-note";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BUSINESS_FACT_MAX_LENGTH } from "@/lib/cofounder/limits";
import type { SaveState } from "@/lib/form-result";

type FactEditorProps = {
  topic: string;
  label: string;
  // The confirmed value the page shows, or null when there is none.
  confirmedValue: string | null;
};

// "Edit" (or "Fill in") for one topic of the business profile (step 36): an
// owner's own words, confirmed as soon as they are saved. Says "Saved." once
// the editor has closed after a save.
export function FactEditor({ topic, label, confirmedValue }: FactEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const buttonLabel = confirmedValue === null ? "Fill in" : "Edit";

  if (isEditing) {
    // Mounted only while editing, so a message from an earlier try is gone
    // when the editor opens again.
    return (
      <EditFactForm
        topic={topic}
        label={label}
        confirmedValue={confirmedValue}
        onSaved={() => {
          setIsEditing(false);
          setJustSaved(true);
        }}
        onCancel={() => setIsEditing(false)}
      />
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={`${buttonLabel} ${label}`}
        onClick={() => {
          setJustSaved(false);
          setIsEditing(true);
        }}
      >
        {buttonLabel}
      </Button>
      <SavedNote saved={justSaved} />
    </div>
  );
}

type EditFactFormProps = FactEditorProps & { onSaved: () => void; onCancel: () => void };

function EditFactForm({ topic, label, confirmedValue, onSaved, onCancel }: EditFactFormProps) {
  // What the editor opened with. The server saves only while the stored fact
  // is still this, so a change another owner saved meanwhile is never
  // overwritten unseen.
  const [openedWith] = useState(confirmedValue ?? "");
  async function save(previous: SaveState | undefined, formData: FormData): Promise<SaveState> {
    const state = await saveFactAction(previous, formData);
    if (state.saved) {
      onSaved();
    }
    return state;
  }
  const [state, saveAction, isSaving] = useActionState(save, undefined);
  const problem = state?.errors?.fieldErrors?.value?.[0] ?? state?.errors?.message;
  const boxId = `fact-${topic}`;

  // WHY by hand (as in the ticket's "Edit" form): when <form action> runs an
  // action, React empties the form's fields afterwards, and what was typed
  // must survive an error. An action started here, in a transition, runs
  // without that reset.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => saveAction(formData));
  }

  return (
    <form action={saveAction} onSubmit={submit} className="grid gap-2">
      <input type="hidden" name="topic" value={topic} />
      <input type="hidden" name="originalValue" value={openedWith} />
      <Label htmlFor={boxId}>{label}</Label>
      <Textarea
        id={boxId}
        name="value"
        required
        rows={3}
        maxLength={BUSINESS_FACT_MAX_LENGTH}
        defaultValue={openedWith}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${boxId}-help ${boxId}-error` : `${boxId}-help`}
      />
      <p id={`${boxId}-help`} className="text-xs text-muted-foreground">
        Confirmed as soon as you save it, as written by you. Stored as plain text: keep your customers&apos; details out.
      </p>
      {problem && (
        <p id={`${boxId}-error`} role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={isSaving}>
          {isSaving ? "Saving..." : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={isSaving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
