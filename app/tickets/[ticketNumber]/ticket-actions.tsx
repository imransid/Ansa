"use client";

import { useActionState, useState } from "react";
import {
  assignTicketAction,
  closeTicketWithoutEmailAction,
  markTicketSolvedAction,
  reopenTicketAction,
} from "@/app/actions/tickets";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { AssigneeOption } from "@/lib/assignee-menu";
import { SolveControls } from "./solve-controls";

type TicketActionName = "assign" | "solve" | "close" | "reopen";

type TicketActionsProps = {
  ticketId: string;
  ticketNumber: number;
  status: "open" | "solved";
  // The address "Mark as solved" emails, or null when there is none.
  customerEmail: string | null;
  assignedToUserId: string | null;
  // Everyone the ticket can go to, labelled (lib/assignee-menu.ts).
  teamMembers: AssigneeOption[];
  // Only hides the button. reopenTicketForSession refuses non-owners on its own.
  canReopen: boolean;
};

export function TicketActions({
  ticketId,
  ticketNumber,
  status,
  customerEmail,
  assignedToUserId,
  teamMembers,
  canReopen,
}: TicketActionsProps) {
  const [assignErrors, assignAction, isAssigning] = useActionState(assignTicketAction, undefined);
  // Kept here, not in SolveControls: a message about a solve must stay visible
  // after the ticket is solved and those buttons are gone.
  const [solveErrors, solveAction, isSolving] = useActionState(markTicketSolvedAction, undefined);
  const [closeErrors, closeAction, isClosing] = useActionState(closeTicketWithoutEmailAction, undefined);
  const [reopenErrors, reopenAction, isReopening] = useActionState(reopenTicketAction, undefined);

  // Each action keeps its last message until that same action runs again, so
  // only the message of the action that ran last is shown: a refused solve's
  // "Nothing was done" must not stay above a close that worked.
  const [lastAction, setLastAction] = useState<TicketActionName | null>(null);
  const messages: Record<TicketActionName, string | undefined> = {
    assign: assignErrors?.message,
    solve: solveErrors?.message,
    close: closeErrors?.message,
    reopen: reopenErrors?.message,
  };
  const message = lastAction ? messages[lastAction] : undefined;
  // A refused assignment is about the menu: tie the message to it.
  const assignFailed = lastAction === "assign" && message !== undefined;
  // The menu always shows the saved assignee: a refused assignment changed nothing.
  const shownAssignee = assignedToUserId ?? "";

  // Gives a form an action that first remembers it ran last, then runs.
  function asLastAction(name: TicketActionName, action: (formData: FormData) => void) {
    return (formData: FormData) => {
      setLastAction(name);
      action(formData);
    };
  }

  return (
    <section className="grid gap-4 rounded-lg border p-4">
      {message && (
        <p id="ticket-action-message" role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <form action={asLastAction("assign", assignAction)} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="ticketId" value={ticketId} />
        <div className="grid gap-2">
          <Label htmlFor="assigneeUserId">Assigned to</Label>
          {/* key: React reads a select's defaultValue only when it first
              renders. A new key builds the menu again with the saved value
              after each save. */}
          <NativeSelect
            key={shownAssignee}
            id="assigneeUserId"
            name="assigneeUserId"
            defaultValue={shownAssignee}
            aria-invalid={assignFailed || undefined}
            aria-describedby={assignFailed ? "ticket-action-message" : undefined}
            className="min-w-48 max-w-full"
          >
            <option value="">Unassigned</option>
            {teamMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {member.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline" disabled={isAssigning}>
          {isAssigning ? "Saving..." : "Save"}
        </Button>
      </form>

      {status === "open" && (
        <SolveControls
          key={customerEmail ?? "no-email"}
          ticketId={ticketId}
          ticketNumber={ticketNumber}
          customerEmail={customerEmail}
          solveAction={asLastAction("solve", solveAction)}
          isSolving={isSolving}
          closeAction={asLastAction("close", closeAction)}
          isClosing={isClosing}
        />
      )}

      {status === "solved" && canReopen && (
        <form action={asLastAction("reopen", reopenAction)}>
          <input type="hidden" name="ticketId" value={ticketId} />
          <Button type="submit" variant="outline" disabled={isReopening}>
            {isReopening ? "Reopening..." : "Reopen ticket"}
          </Button>
        </form>
      )}
    </section>
  );
}
