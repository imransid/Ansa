"use client";

import { useActionState } from "react";
import { generateDraftImageAction, setDraftMediaAction } from "@/app/actions/media";
import { Button } from "@/components/ui/button";
import type { FormErrors } from "@/lib/form-result";
import { useReportPending } from "@/lib/report-pending";

type ActionOfDraft = (previous: FormErrors | undefined, formData: FormData) => Promise<FormErrors | undefined>;

// Told when a button's action starts and ends: the editor holds still meanwhile.
type PendingListener = (isPending: boolean) => void;

type MediaButtonProps = {
  draftId: string;
  // The version on screen: the change is refused when the draft changed since.
  version: number;
  disabled: boolean;
  onPendingChange: PendingListener;
};

// "Use this" on one image or video of the picker, or "Take it off the
// draft" (assetId ""): either is the draft's next version, without approval.
export function SetDraftMediaButton({ assetId, label, accessibleLabel, ...draft }: MediaButtonProps & { assetId: string; label: string; accessibleLabel?: string }) {
  return (
    <DraftMediaButton
      {...draft}
      action={setDraftMediaAction}
      fields={{ assetId }}
      label={label}
      accessibleLabel={accessibleLabel}
      pendingLabel={assetId ? "Attaching..." : "Taking it off..."}
    />
  );
}

// "Make the image with the AI": from the saved image description; the
// image is made after the answer and attached as the next version.
export function MakeDraftImageButton(props: MediaButtonProps) {
  return <DraftMediaButton {...props} action={generateDraftImageAction} fields={{}} label="Make the image with the AI" pendingLabel="Asking..." />;
}

type DraftMediaButtonProps = MediaButtonProps & {
  action: ActionOfDraft;
  fields: Record<string, string>;
  label: string;
  accessibleLabel?: string;
  pendingLabel: string;
};

// One button that runs one action about the draft's media, with its
// failure next to it.
function DraftMediaButton({ draftId, version, disabled, onPendingChange, action, fields, label, accessibleLabel, pendingLabel }: DraftMediaButtonProps) {
  const [errors, formAction, isPending] = useActionState(action, undefined);
  useReportPending(isPending, onPendingChange);
  return (
    <form action={formAction} className="grid max-w-sm gap-1">
      <input type="hidden" name="draftId" value={draftId} />
      <input type="hidden" name="version" value={version} />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" size="sm" variant="outline" className="justify-self-start" aria-label={accessibleLabel} disabled={disabled || isPending}>
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
