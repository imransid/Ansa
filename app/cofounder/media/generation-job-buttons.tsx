"use client";

import { useActionState } from "react";
import { cancelGenerationAction, startGenerationNowAction } from "@/app/actions/media";
import { ConfirmButton } from "@/components/confirm-button";
import { Button } from "@/components/ui/button";
import { useReportPending } from "@/lib/report-pending";

// Cancel a request still waiting to start (step 39): it asks first, as
// every button that ends something for good does.
export function CancelGenerationButton({ jobId, onPendingChange }: { jobId: string; onPendingChange?: (isPending: boolean) => void }) {
  return (
    <ConfirmButton
      action={cancelGenerationAction}
      fields={{ jobId }}
      label="Cancel"
      accessibleLabel="Cancel this request"
      question="Cancel this request? Nothing is made, and it can't be started again."
      confirmLabel="Yes, cancel it"
      pendingLabel="Canceling..."
      onPendingChange={onPendingChange}
    />
  );
}

// "Start now" on a stuck request: its run never started, or was cut off.
// The server claims it before answering, so the page that comes back
// already shows it being made (and refreshes itself); the image service is
// asked right after the answer.
export function StartGenerationNowButton({ jobId, onPendingChange }: { jobId: string; onPendingChange?: (isPending: boolean) => void }) {
  const [errors, action, isStarting] = useActionState(startGenerationNowAction, undefined);
  useReportPending(isStarting, onPendingChange);
  return (
    <form action={action} className="grid max-w-sm gap-1">
      <input type="hidden" name="jobId" value={jobId} />
      <Button type="submit" size="sm" variant="outline" className="justify-self-start" disabled={isStarting}>
        {isStarting ? "Starting..." : "Start now"}
      </Button>
      {errors?.message && !isStarting && (
        <p role="alert" className="text-sm text-destructive wrap-anywhere">
          {errors.message}
        </p>
      )}
    </form>
  );
}
