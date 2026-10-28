import type { TicketActivityKind } from "@/db/schema";

// How the ticket page puts a ticket's assignment and history into words
// (steps 10 and 30). Plain functions, so the checks can read the same text.

export type AssignmentToDescribe = {
  assigneeName: string | null;
  assignedAutomatically: boolean | null;
};

export type ActivityToDescribe = {
  kind: TicketActivityKind;
  actorUserId: string | null;
  actorName: string | null;
  targetUserId: string | null;
  targetName: string | null;
  category: string | null;
};

// Who has the ticket and how they got it: routed, or picked by a person. No
// "why", and never the current category: routing may have followed the same
// customer's other open ticket (step 29), and the category may have changed
// since. The history says what routing followed at the time.
export function describeAssignment(ticket: AssignmentToDescribe): string {
  if (!ticket.assigneeName) {
    return "Nobody yet";
  }
  return `${ticket.assigneeName}, ${ticket.assignedAutomatically ? "routed automatically" : "assigned by a person"}`;
}

// One line saying what happened, for one history entry. A routing line names
// the category routing followed THEN (stored on the entry), not the ticket's
// current one.
export function describeTicketActivity(activity: ActivityToDescribe): string {
  const actor = activity.actorName ?? "Someone";
  const target = activity.targetName ?? "someone";
  switch (activity.kind) {
    case "note":
      return `${actor} added a note`;
    case "assigned":
      return activity.actorUserId === activity.targetUserId ? `${actor} took the ticket` : `${actor} assigned it to ${target}`;
    case "unassigned":
      return describeUnassignment(activity);
    case "routed":
      return describeRouting(activity);
    case "solved":
      return `${actor} marked it solved`;
    case "closed_without_email":
      return `${actor} closed it without emailing the customer`;
    case "reopened":
      return `${actor} reopened it`;
    case "category_set":
      return activity.category ? `${actor} set the category to ${activity.category}` : `${actor} removed the category`;
    case "customer_email_set":
      return `${actor} set the customer's email`;
    case "created":
      return `${actor} created the ticket`;
    case "escalated":
      return `${actor} escalated the call to a ticket: the AI had marked it solved`;
    case "subject_changed":
      return `${actor} changed the subject`;
    case "customer_name_changed":
      return `${actor} changed the customer's name`;
  }
}

// True when the history itself says who made the ticket (step 31: typed in,
// or escalated from a call): the page then leaves out its own "Ticket
// created" line, which would say the same thing again.
export function historyNamesItsCreator(kinds: TicketActivityKind[]): boolean {
  return kinds.some((kind) => kind === "created" || kind === "escalated");
}

// A person unassigning, or the app (no actor) taking the ticket off someone
// who could no longer have it: removed from the team, or an account that
// never confirmed, whose name is gone once it is deleted.
function describeUnassignment(activity: ActivityToDescribe): string {
  const actor = activity.actorName ?? "Someone";
  const target = activity.targetName ?? "someone";
  if (activity.actorUserId === null && activity.targetUserId === null) {
    return "Taken off its assignee automatically: their account was deleted";
  }
  if (activity.actorUserId === null) {
    return `Taken off ${target} automatically: they can no longer take tickets`;
  }
  if (activity.actorUserId === activity.targetUserId) {
    return `${actor} gave the ticket up`;
  }
  return `${actor} took it off ${target}`;
}

// Routing by category, or to whoever had the same customer's other open
// ticket (no category on the entry).
function describeRouting(activity: ActivityToDescribe): string {
  const target = activity.targetName ?? "someone";
  if (activity.category) {
    return `Routed automatically to ${target} for the category ${activity.category}`;
  }
  return `Routed automatically to ${target}, who had this customer's other open ticket`;
}
