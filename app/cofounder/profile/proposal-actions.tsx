"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { confirmFactAction, dismissProposalAction } from "@/app/actions/cofounder";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BUSINESS_FACT_MAX_LENGTH } from "@/lib/cofounder/limits";
import type { FormErrors } from "@/lib/form-result";

type ProposalActionsProps = {
  topic: string;
  label: string;
  // The proposal as the page shows it. Each button sends it back, and /db
  // acts only while it is still the proposal, so nobody confirms or
  // dismisses words they didn't see.
  proposal: string;
  // The confirmed value the page shows beside it (null: none). Confirming
  // sends it back too, so a value another owner saved meanwhile is never
  // replaced unseen.
  confirmedValue: string | null;
};

// An owner's buttons for one waiting proposal (step 36): Confirm makes it the
// fact as it is, "Edit and confirm" lets them change it first, Dismiss drops
// it (the confirmed value stays). Each shows its own failure next to it.
export function ProposalActions({ topic, label, proposal, confirmedValue }: ProposalActionsProps) {
  const [isEditing, setIsEditing] = useState(false);
  const shownConfirmedValue = confirmedValue ?? "";
  if (isEditing) {
    // Mounted only while editing, so a message from an earlier try is gone
    // when the editor opens again.
    return (
      <EditAndConfirmForm
        topic={topic}
        label={label}
        proposal={proposal}
        shownConfirmedValue={shownConfirmedValue}
        onCancel={() => setIsEditing(false)}
      />
    );
  }
  return (
    <div className="flex flex-wrap items-start gap-2">
      <ProposalButton
        action={confirmFactAction}
        topic={topic}
        proposal={proposal}
        shownConfirmedValue={shownConfirmedValue}
        label="Confirm"
        pendingLabel="Confirming..."
        accessibleLabel={`Confirm the proposed ${label}`}
        primary
      />
      <Button type="button" size="sm" variant="outline" aria-label={`Edit and confirm the proposed ${label}`} onClick={() => setIsEditing(true)}>
        Edit and confirm
      </Button>
      <ProposalButton
        action={dismissProposalAction}
        topic={topic}
        proposal={proposal}
        label="Dismiss"
        pendingLabel="Dismissing..."
        accessibleLabel={`Dismiss the proposed ${label}`}
      />
    </div>
  );
}

type ProposalButtonProps = {
  action: (previous: FormErrors | undefined, formData: FormData) => Promise<FormErrors | undefined>;
  topic: string;
  proposal: string;
  // Confirm only ("" = none): Dismiss never touches the confirmed value.
  shownConfirmedValue?: string;
  label: string;
  pendingLabel: string;
  accessibleLabel: string;
  primary?: boolean;
};

function ProposalButton({ action, topic, proposal, shownConfirmedValue, label, pendingLabel, accessibleLabel, primary = false }: ProposalButtonProps) {
  const [errors, formAction, isPending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="grid max-w-sm gap-1">
      <input type="hidden" name="topic" value={topic} />
      <input type="hidden" name="shownProposal" value={proposal} />
      {shownConfirmedValue !== undefined && <input type="hidden" name="shownConfirmedValue" value={shownConfirmedValue} />}
      <Button type="submit" size="sm" variant={primary ? "default" : "outline"} disabled={isPending} aria-label={accessibleLabel}>
        {isPending ? pendingLabel : label}
      </Button>
      {errors?.message && (
        <p role="alert" className="text-sm text-destructive">
          {errors.message}
        </p>
      )}
    </form>
  );
}

type EditAndConfirmFormProps = { topic: string; label: string; proposal: string; shownConfirmedValue: string; onCancel: () => void };

function EditAndConfirmForm({ topic, label, proposal, shownConfirmedValue, onCancel }: EditAndConfirmFormProps) {
  // The proposal and the confirmed value the editor opened with: what this
  // confirms over. If the page shows newer ones meanwhile, /db refuses it.
  const [openedWith] = useState(proposal);
  const [confirmedWhenOpened] = useState(shownConfirmedValue);
  const [errors, confirmAction, isSaving] = useActionState(confirmFactAction, undefined);
  const problem = errors?.fieldErrors?.value?.[0] ?? errors?.message;
  const boxId = `confirm-${topic}`;

  // WHY by hand (as in the ticket's "Edit" form): when <form action> runs an
  // action, React empties the form's fields afterwards, and what was typed
  // must survive an error. An action started here, in a transition, runs
  // without that reset. On success the proposal is gone, and so is this form.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => confirmAction(formData));
  }

  return (
    <form action={confirmAction} onSubmit={submit} className="grid gap-2">
      <input type="hidden" name="topic" value={topic} />
      <input type="hidden" name="shownProposal" value={openedWith} />
      <input type="hidden" name="shownConfirmedValue" value={confirmedWhenOpened} />
      <Label htmlFor={boxId}>{label}, as it should be confirmed</Label>
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
        Stored as plain text: keep your customers&apos; details out.
      </p>
      {problem && (
        <p id={`${boxId}-error`} role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={isSaving}>
          {isSaving ? "Confirming..." : "Confirm this text"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={isSaving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
