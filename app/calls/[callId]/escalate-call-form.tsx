"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import { escalateCallAction } from "@/app/actions/calls";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ESCALATION_NOTE_MAX_LENGTH } from "@/lib/ticket-limits";
import type { CategoryChoice } from "@/services/categories";

type EscalateCallFormProps = {
  callId: string;
  // The company's active categories; the ticket is routed by the one picked.
  categories: CategoryChoice[];
};

// "Escalate to a ticket" for a call the AI marked solved (step 31). On
// success the action opens the new ticket's page.
export function EscalateCallForm({ callId, categories }: EscalateCallFormProps) {
  const [errors, escalateAction, isEscalating] = useActionState(escalateCallAction, undefined);
  const noteError = errors?.fieldErrors?.note?.[0];
  const message = errors?.message ?? (errors?.fieldErrors && !noteError ? "Unknown call or category." : undefined);

  // WHY by hand: when <form action> runs an action, React empties the form's
  // fields afterwards, and a note typed here must survive an error. An action
  // started here, in a transition, runs without that reset.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => escalateAction(formData));
  }

  return (
    <form action={escalateAction} onSubmit={submit} className="grid gap-3 border-t pt-3">
      <input type="hidden" name="callId" value={callId} />
      <p className="text-sm">
        Did the AI get this one wrong? Escalating opens a ticket for this call, routed like any other. The AI&apos;s
        verdict stays recorded as solved, so how often it is wrong can still be measured.
      </p>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <div className="grid gap-2">
        <Label htmlFor="escalation-category">Category</Label>
        <NativeSelect id="escalation-category" name="categoryId" defaultValue="" className="min-w-48 max-w-full justify-self-start">
          <option value="">No category</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="escalation-note">What still needs doing? (optional)</Label>
        <Textarea
          id="escalation-note"
          name="note"
          rows={3}
          maxLength={ESCALATION_NOTE_MAX_LENGTH}
          aria-invalid={noteError ? true : undefined}
          aria-describedby={noteError ? "escalation-note-error" : undefined}
        />
        {noteError && (
          <p id="escalation-note-error" role="alert" className="text-sm text-destructive">
            {noteError}
          </p>
        )}
      </div>
      <Button type="submit" variant="outline" className="justify-self-start" disabled={isEscalating}>
        {isEscalating ? "Escalating..." : "Escalate to a ticket"}
      </Button>
    </form>
  );
}
