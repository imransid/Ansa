"use client";

import type { ReactNode } from "react";
import { SavedNote } from "@/components/saved-note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type EditorFieldProps = {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  readOnly: boolean;
  // A line under the box: what goes in it.
  help?: ReactNode;
  // The field's error from the last save, announced and tied to the box.
  error?: string;
};

// One line of the draft editor (step 38), controlled by the editor's state
// so the counts and the preview follow every key.
export function EditorLine({ id, name, label, value, onChange, maxLength, readOnly, help, error }: EditorFieldProps) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        autoComplete="off"
        maxLength={maxLength}
        readOnly={readOnly}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={describedBy(id, help, error)}
        aria-invalid={error ? true : undefined}
      />
      <FieldNotes id={id} help={help} error={error} />
    </div>
  );
}

// A box of several lines of the draft editor.
export function EditorBox({ id, name, label, value, onChange, maxLength, readOnly, help, error, rows }: EditorFieldProps & { rows: number }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        name={name}
        rows={rows}
        maxLength={maxLength}
        readOnly={readOnly}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={describedBy(id, help, error)}
        aria-invalid={error ? true : undefined}
      />
      <FieldNotes id={id} help={help} error={error} />
    </div>
  );
}

type EditorButtonsProps = {
  // Unsaved changes: only then are Save and Undo there to press.
  isDirty: boolean;
  // What saving a change takes away (an approval, scheduled posts), shown
  // once something is typed; null: nothing.
  changeWarning: string | null;
  isBusy: boolean;
  isSaving: boolean;
  // The last save worked, and nothing was typed since.
  saved: boolean;
  onUndo: () => void;
};

// The editor's Save and "Undo changes".
export function EditorButtons({ isDirty, changeWarning, isBusy, isSaving, saved, onUndo }: EditorButtonsProps) {
  return (
    <div className="grid gap-2">
      {changeWarning && isDirty && <p className="text-sm">{changeWarning}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isSaving || isBusy || !isDirty}>
          {isSaving ? "Saving..." : "Save"}
        </Button>
        <Button type="button" variant="ghost" disabled={isSaving || isBusy || !isDirty} onClick={onUndo}>
          Undo changes
        </Button>
        <SavedNote saved={saved} />
      </div>
    </div>
  );
}

function FieldNotes({ id, help, error }: { id: string; help?: ReactNode; error?: string }) {
  return (
    <>
      {help && (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}

function describedBy(id: string, help: ReactNode, error: string | undefined): string | undefined {
  const ids = [help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}
