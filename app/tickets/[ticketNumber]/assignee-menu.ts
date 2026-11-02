import { labelAssigneeOptions, type AssigneeOption } from "@/lib/assignee-menu";
import type { TicketView } from "@/lib/core-views/tickets";
import type { AssignableUser } from "@/lib/types/users";

// The "Assigned to" menu: everyone who can take tickets, with the email next
// to a name two people share (lib/assignee-menu.ts). A solved ticket may still
// be assigned to someone who can't any more (removed from the team); they are
// added, marked, so the menu doesn't pretend the ticket is unassigned. Saving
// the menu unchanged changes nothing; giving them any other ticket is refused
// (core/internal/tickets).
export function listAssigneeMenu(choices: AssignableUser[], ticket: Pick<TicketView, "assignedToUserId" | "assigneeName">): AssigneeOption[] {
  const currentAssigneeId = ticket.assignedToUserId;
  if (!currentAssigneeId || choices.some((person) => person.id === currentAssigneeId)) {
    return labelAssigneeOptions(choices);
  }
  const formerAssignee = { id: currentAssigneeId, name: `${ticket.assigneeName ?? "Someone"} (can't take tickets)`, email: null };
  return labelAssigneeOptions([...choices, formerAssignee]);
}
