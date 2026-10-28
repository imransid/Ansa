"use client";

import { useActionState, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { FormErrors } from "@/lib/form-result";
import { useReportPending } from "@/lib/report-pending";

type ConfirmButtonProps = {
  // The server action that does it: the errors, or undefined when it worked.
  action: (previous: FormErrors | undefined, formData: FormData) => Promise<FormErrors | undefined>;
  // The hidden fields the action reads (which address, document or invite).
  fields: Record<string, string>;
  // The first button, e.g. "Remove". Clicking it only asks.
  label: string;
  // Read by screen readers instead of label, when label alone doesn't say
  // what it acts on ("Remove support@acme.com").
  accessibleLabel?: string;
  // What will happen, in plain words, shown before anything is done.
  question: ReactNode;
  // e.g. "Yes, remove" and "Removing...".
  confirmLabel: string;
  pendingLabel: string;
  // Told when the action starts and when it ends, for a page that holds
  // still meanwhile (the content studio's editor while the AI writes).
  onPendingChange?: (isPending: boolean) => void;
};

// Every destructive action in the app: two steps, so one stray click never
// removes anything. The first click shows what will happen; only "Yes, ..."
// runs the action. A failure stays next to it (role="alert"); when it works,
// the page refreshes and the row it sat on is gone.
export function ConfirmButton(props: ConfirmButtonProps) {
  const { action, fields, label, accessibleLabel, question, confirmLabel, pendingLabel, onPendingChange } = props;
  const [isConfirming, setIsConfirming] = useState(false);
  const [errors, formAction, isPending] = useActionState(action, undefined);
  useReportPending(isPending, onPendingChange);

  if (!isConfirming) {
    return (
      <Button type="button" variant="outline" size="sm" aria-label={accessibleLabel} onClick={() => setIsConfirming(true)}>
        {label}
      </Button>
    );
  }
  return (
    <form action={formAction} className="grid max-w-sm gap-2 text-left">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <p className="whitespace-normal wrap-anywhere text-sm">{question}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" size="sm" disabled={isPending}>
          {isPending ? pendingLabel : confirmLabel}
        </Button>
        {/* Focus moves here when the question opens: the button that was
            clicked is gone, and Enter on Cancel can't remove anything. */}
        <Button type="button" variant="ghost" size="sm" disabled={isPending} autoFocus onClick={() => setIsConfirming(false)}>
          Cancel
        </Button>
      </div>
      {errors?.message && (
        <p role="alert" className="whitespace-normal text-sm text-destructive">
          {errors.message}
        </p>
      )}
    </form>
  );
}
