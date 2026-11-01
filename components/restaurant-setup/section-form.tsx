"use client";

import { useActionState, useState, type ReactNode } from "react";
import Link from "next/link";
import { SavedNote } from "@/components/saved-note";
import { Button, buttonVariants } from "@/components/ui/button";
import type { SaveState } from "@/lib/form-result";

// Where a section form of the restaurant setup sits (step 45): in the setup at
// /welcome (it moves on to the next step) or on a Settings page (it says
// "Saved." and stays).
export type SectionFormPlace = "setup" | "settings";

type SectionFormProps = {
  action: (previous: SaveState | undefined, formData: FormData) => Promise<SaveState>;
  place: SectionFormPlace;
  // The setup's previous step, for its Back link.
  backHref?: string;
  // The fields, given what the last save answered (errors and what was typed).
  children: (state: SaveState | undefined) => ReactNode;
};

// One section of the restaurant setup as a form, the same in the setup and in
// Settings. After a refused save it shows what was typed again (the action
// sends it back), with each mistake next to its field.
export function SectionForm({ action, place, backHref, children }: SectionFormProps) {
  const [state, formAction, isSaving] = useActionState(action, undefined);
  // "Saved." is about what was saved: typing again hides it.
  const [changedSinceSave, setChangedSinceSave] = useState(false);
  return (
    <form action={formAction} onInput={() => setChangedSinceSave(true)} onSubmit={() => setChangedSinceSave(false)} className="grid gap-6">
      <input type="hidden" name="from" value={place} />
      {state?.errors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {state.errors.message}
        </p>
      )}
      {children(state)}
      <div className="flex flex-wrap items-center gap-3">
        {place === "setup" && backHref && (
          <Link href={backHref} className={buttonVariants({ variant: "ghost" })}>
            Back
          </Link>
        )}
        <Button type="submit" size={place === "setup" ? "lg" : "default"} disabled={isSaving}>
          {isSaving ? "Saving..." : place === "setup" ? "Continue" : "Save"}
        </Button>
        {place === "settings" && <SavedNote saved={state?.saved === true && !isSaving && !changedSinceSave} />}
      </div>
    </form>
  );
}

// A field's mistakes, announced as they appear and tied to the field by id.
export function FieldErrors({ id, errors }: { id: string; errors?: string[] }) {
  const unique = [...new Set(errors ?? [])];
  if (unique.length === 0) {
    return null;
  }
  return (
    <div id={id} role="alert" className="grid gap-1 text-sm text-destructive">
      {unique.map((error) => (
        <p key={error}>{error}</p>
      ))}
    </div>
  );
}

// A short help line under a field.
export function FieldHint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-xs text-muted-foreground">
      {children}
    </p>
  );
}
