"use client";

import { useActionState, useState } from "react";
import { addTicketNoteAction } from "@/app/actions/tickets";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { FormErrors } from "@/lib/form-result";
import { TICKET_NOTE_MAX_LENGTH } from "@/lib/ticket-notes";

// The box for adding an internal note. Its text is kept in state, not left to
// the browser: React empties a form's own fields after every submit, and a
// long note must not be lost to "Too many changes". It is emptied only once
// the note is saved, and can't be typed in while saving: emptying it would
// throw away words that were never sent.
export function NoteForm({ ticketId }: { ticketId: string }) {
  const [body, setBody] = useState("");

  async function saveNote(previousErrors: FormErrors | undefined, formData: FormData) {
    const errors = await addTicketNoteAction(previousErrors, formData);
    if (!errors) {
      setBody("");
    }
    return errors;
  }

  const [errors, formAction, isSaving] = useActionState(saveNote, undefined);
  const errorMessage = errors?.fieldErrors?.body?.[0] ?? errors?.message;

  return (
    <form action={formAction} className="grid gap-2">
      <input type="hidden" name="ticketId" value={ticketId} />
      <Label htmlFor="ticket-note">Add a note</Label>
      <Textarea
        id="ticket-note"
        name="body"
        required
        rows={3}
        maxLength={TICKET_NOTE_MAX_LENGTH}
        readOnly={isSaving}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        aria-describedby={errorMessage ? "ticket-note-help ticket-note-error" : "ticket-note-help"}
        aria-invalid={errorMessage ? true : undefined}
      />
      <p id="ticket-note-help" className="text-xs text-muted-foreground">
        For your team only: what you did, what you promised, what to do next. Never emailed to the customer.
      </p>
      {errorMessage && (
        <p id="ticket-note-error" role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      )}
      <Button type="submit" variant="outline" className="justify-self-start" disabled={isSaving}>
        {isSaving ? "Saving..." : "Add note"}
      </Button>
    </form>
  );
}
