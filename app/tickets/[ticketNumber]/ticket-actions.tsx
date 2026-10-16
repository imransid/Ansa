"use client";

import { useActionState } from "react";
import {
  assignTicketAction,
  markTicketSolvedAction,
  reopenTicketAction,
} from "@/app/actions/tickets";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type TeamMemberOption = { id: string; name: string };

type TicketActionsProps = {
  ticketId: string;
  status: "open" | "solved";
  assignedToUserId: string | null;
  teamMembers: TeamMemberOption[];
  // Only hides the button. reopenTicketForSession refuses non-owners on its own.
  canReopen: boolean;
};

export function TicketActions({
  ticketId,
  status,
  assignedToUserId,
  teamMembers,
  canReopen,
}: TicketActionsProps) {
  const [assignErrors, assignAction, isAssigning] = useActionState(assignTicketAction, undefined);
  const [solveErrors, solveAction, isSolving] = useActionState(markTicketSolvedAction, undefined);
  const [reopenErrors, reopenAction, isReopening] = useActionState(reopenTicketAction, undefined);
  const message = assignErrors?.message ?? solveErrors?.message ?? reopenErrors?.message;

  return (
    <section className="grid gap-4 rounded-lg border p-4">
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <form action={assignAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="ticketId" value={ticketId} />
        <div className="grid gap-2">
          <Label htmlFor="assigneeUserId">Assigned to</Label>
          {/* key makes the menu show the saved value again after each save. */}
          <select
            key={assignedToUserId ?? "unassigned"}
            id="assigneeUserId"
            name="assigneeUserId"
            defaultValue={assignedToUserId ?? ""}
            className="h-9 min-w-48 rounded-md border bg-transparent px-3 text-sm"
          >
            <option value="">Unassigned</option>
            {teamMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline" disabled={isAssigning}>
          {isAssigning ? "Saving..." : "Save"}
        </Button>
      </form>

      {status === "open" && (
        <form action={solveAction}>
          <input type="hidden" name="ticketId" value={ticketId} />
          <Button type="submit" disabled={isSolving}>
            {isSolving ? "Saving..." : "Mark as solved"}
          </Button>
        </form>
      )}

      {status === "solved" && canReopen && (
        <form action={reopenAction}>
          <input type="hidden" name="ticketId" value={ticketId} />
          <Button type="submit" variant="outline" disabled={isReopening}>
            {isReopening ? "Reopening..." : "Reopen ticket"}
          </Button>
        </form>
      )}
    </section>
  );
}
