"use client";

import { useActionState } from "react";
import { makeTicketFromEmailAction, processEmailAgainAction } from "@/app/actions/emails";
import { Button } from "@/components/ui/button";

type EmailActionButtonProps = {
  inboundEmailId: string;
  // "process-again": for an email that failed or got stuck (filters apply).
  // "ticket-anyway": for an email the filters skipped.
  action: "process-again" | "ticket-anyway";
};

const BUTTON_LABELS = { "process-again": "Process again", "ticket-anyway": "Make a ticket anyway" };

// One email's button on the Emails page. Both can ask Claude, so they may
// take a minute.
export function EmailActionButton({ inboundEmailId, action }: EmailActionButtonProps) {
  const serverAction = action === "process-again" ? processEmailAgainAction : makeTicketFromEmailAction;
  const [errors, formAction, isRunning] = useActionState(serverAction, undefined);

  return (
    <form action={formAction} className="grid justify-items-end gap-1">
      <input type="hidden" name="inboundEmailId" value={inboundEmailId} />
      <Button type="submit" variant="outline" size="sm" disabled={isRunning}>
        {isRunning ? "Working..." : BUTTON_LABELS[action]}
      </Button>
      {errors?.message && (
        <p role="alert" className="max-w-64 text-right text-sm text-destructive">
          {errors.message}
        </p>
      )}
    </form>
  );
}
