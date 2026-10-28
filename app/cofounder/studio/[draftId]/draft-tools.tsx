"use client";

import { useActionState } from "react";
import { archiveDraftAction, regenerateDraftAction, restoreDraftAction } from "@/app/actions/content-studio";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import type { FormErrors } from "@/lib/form-result";
import { useReportPending } from "@/lib/report-pending";

type ActionOfDraft = (previous: FormErrors | undefined, formData: FormData) => Promise<FormErrors | undefined>;

// Told when a button's action starts and ends: the editor holds still meanwhile.
type PendingListener = (isPending: boolean) => void;

type RegenerateProps = {
  draftId: string;
  version: number;
  // Nothing written yet: the AI writes the first text.
  isIdea: boolean;
  // Someone changed the AI's text (or wrote it): asking first, as it is replaced.
  editedByHand: boolean;
  // Unsaved changes in the editor would be lost.
  isDirty: boolean;
  // Scheduled (step 41): the new text cancels its scheduled posts.
  isScheduled: boolean;
  onPendingChange: PendingListener;
};

// Regenerate (step 38, anyone): new text from the AI for the same platform,
// format and topic, as the next version; an approval is cleared. When
// someone changed the text by hand, or the draft is scheduled, it asks
// first: that text is replaced, or its scheduled posts are canceled.
export function RegenerateButton({ draftId, version, isIdea, editedByHand, isDirty, isScheduled, onPendingChange }: RegenerateProps) {
  const label = isIdea ? "Write it with the AI" : "Regenerate with the AI";
  const fields = { draftId, version: String(version) };
  const pendingLabel = "The AI is writing (a minute or two)...";
  if (isDirty) {
    return (
      <Button type="button" variant="outline" size="sm" disabled>
        {label}
      </Button>
    );
  }
  if (editedByHand || isScheduled) {
    return (
      <ConfirmButton
        action={regenerateDraftAction}
        fields={fields}
        label={label}
        question={describeRegenerating(editedByHand, isScheduled)}
        confirmLabel="Yes, replace it"
        pendingLabel={pendingLabel}
        onPendingChange={onPendingChange}
      />
    );
  }
  return <DraftButton action={regenerateDraftAction} fields={fields} label={label} pendingLabel={pendingLabel} onPendingChange={onPendingChange} />;
}

// What Regenerate's question says it takes away.
function describeRegenerating(editedByHand: boolean, isScheduled: boolean): string {
  const replaced = editedByHand ? "The text was written or changed by hand. The AI's new text replaces it, and it can't be brought back. " : "";
  const canceled = isScheduled ? "This draft is scheduled: the new text cancels its scheduled posts, to be approved and scheduled again. " : "";
  return `${replaced}${canceled}Go on?`;
}

type ArchiveProps = { draftId: string; isArchived: boolean; isScheduled: boolean; isDirty: boolean; onPendingChange: PendingListener };

// Archive (anyone): put away, never approved or published while archived;
// an approval is cleared. Restore makes it a draft again, to be approved
// again. Both can be undone, so neither asks first, except archiving a
// scheduled draft (step 41): its scheduled posts are canceled, and a
// restore doesn't bring them back.
export function ArchiveButton({ draftId, isArchived, isScheduled, isDirty, onPendingChange }: ArchiveProps) {
  if (isArchived) {
    return <DraftButton action={restoreDraftAction} fields={{ draftId }} label="Restore" pendingLabel="Restoring..." onPendingChange={onPendingChange} />;
  }
  if (isDirty) {
    return (
      <Button type="button" variant="outline" size="sm" disabled>
        Archive
      </Button>
    );
  }
  if (isScheduled) {
    return (
      <ConfirmButton
        action={archiveDraftAction}
        fields={{ draftId }}
        label="Archive"
        question="Archiving cancels this draft's scheduled posts (a post going out right now still goes). Restoring it later doesn't schedule them again. Archive it?"
        confirmLabel="Yes, archive it"
        pendingLabel="Archiving..."
        onPendingChange={onPendingChange}
      />
    );
  }
  return <DraftButton action={archiveDraftAction} fields={{ draftId }} label="Archive" pendingLabel="Archiving..." onPendingChange={onPendingChange} />;
}

type DraftButtonProps = {
  action: ActionOfDraft;
  fields: Record<string, string>;
  label: string;
  pendingLabel: string;
  onPendingChange: PendingListener;
};

// One button that runs one action, with its failure next to it.
function DraftButton({ action, fields, label, pendingLabel, onPendingChange }: DraftButtonProps) {
  const [errors, formAction, isPending] = useActionState(action, undefined);
  useReportPending(isPending, onPendingChange);
  return (
    <form action={formAction} className="grid max-w-sm gap-1">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" size="sm" variant="outline" className="justify-self-start" disabled={isPending}>
        {isPending ? pendingLabel : label}
      </Button>
      {errors?.message && !isPending && (
        <p role="alert" className="text-sm text-destructive wrap-anywhere">
          {errors.message}
        </p>
      )}
    </form>
  );
}
