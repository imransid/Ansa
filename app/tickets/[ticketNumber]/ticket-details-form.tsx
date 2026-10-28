"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { editTicketDetailsAction } from "@/app/actions/tickets";
import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import type { FormErrors } from "@/lib/form-result";
import { CUSTOMER_NAME_MAX_LENGTH, TICKET_SUBJECT_MAX_LENGTH } from "@/lib/ticket-limits";

type TicketDetailsFormProps = {
  ticketId: string;
  subject: string;
  customerName: string | null;
};

// "Edit" for the ticket's subject and the customer's name (step 31): the AI
// writes the first subject, and a phone ticket starts without a name. Anyone
// in the company may change them; the history records who did.
export function TicketDetailsForm(props: TicketDetailsFormProps) {
  const [isEditing, setIsEditing] = useState(false);
  if (!isEditing) {
    return (
      <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => setIsEditing(true)}>
        Edit subject or customer name
      </Button>
    );
  }
  // Mounted only while editing, so a message from an earlier try is gone
  // when the editor opens again.
  return <EditDetailsForm {...props} onClose={() => setIsEditing(false)} />;
}

function EditDetailsForm({ ticketId, subject, customerName, onClose }: TicketDetailsFormProps & { onClose: () => void }) {
  // What the editor opened with. Its fields start from it and keep it when the
  // page refreshes while it is open (React would move an untouched field to
  // the new value). The server saves only the fields that differ from it, so
  // a field left alone never undoes a teammate's change made meanwhile.
  const [openedWith] = useState({ subject, customerName: customerName ?? "" });
  async function save(previousErrors: FormErrors | undefined, formData: FormData) {
    const errors = await editTicketDetailsAction(previousErrors, formData);
    if (!errors) {
      onClose();
    }
    return errors;
  }
  const [errors, saveAction, isSaving] = useActionState(save, undefined);
  const fieldErrors = errors?.fieldErrors;
  // The hidden fields have no place to show an error of their own.
  const hiddenFieldFailed = fieldErrors !== undefined && !fieldErrors.subject && !fieldErrors.customerName;
  const message = errors?.message ?? (hiddenFieldFailed ? "This ticket could not be saved. Reload the page and try again." : undefined);

  // WHY by hand (as in the "New ticket" form): when <form action> runs an
  // action, React empties the form's fields afterwards, and what was typed
  // must survive an error. An action started here, in a transition, runs
  // without that reset.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => saveAction(formData));
  }

  return (
    <form action={saveAction} onSubmit={submit} className="grid max-w-xl gap-3 rounded-lg border p-4">
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="originalSubject" value={openedWith.subject} />
      <input type="hidden" name="originalCustomerName" value={openedWith.customerName} />
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <FormField
        name="subject"
        label="Subject"
        autoComplete="off"
        defaultValue={openedWith.subject}
        maxLength={TICKET_SUBJECT_MAX_LENGTH}
        errors={fieldErrors?.subject}
      />
      <FormField
        name="customerName"
        label="Customer's name"
        autoComplete="off"
        defaultValue={openedWith.customerName}
        required={false}
        maxLength={CUSTOMER_NAME_MAX_LENGTH}
        errors={fieldErrors?.customerName}
      />
      <p className="text-xs text-muted-foreground">The history keeps who changed them and when, not the old text.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : "Save"}
        </Button>
        <Button type="button" variant="ghost" disabled={isSaving} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
