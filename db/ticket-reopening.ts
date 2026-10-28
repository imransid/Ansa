import "server-only";
import { and, eq, isNotNull, notExists } from "drizzle-orm";
import { db, type DbTransaction } from "./client";
import { lockCompanyRow } from "./company-lock";
import { routeTicketIfUnassigned } from "./routing";
import { tickets, users } from "./schema";
import { recordTicketChange } from "./ticket-activity";
import { canTakeTickets } from "./users";

export type ReopenResult = {
  reopened: boolean;
  // Who routing gave it to, when its assignee had left the team; else null.
  routedTo: string | null;
};

// Reopens one company's solved ticket and clears who solved it, when, and
// whether it was closed without emailing (solving it again decides anew; the
// ticket's history keeps the earlier solve). If it is assigned to someone who
// can't take tickets any more (removed from the team), it goes back to
// routing, as their other open tickets did when they were removed
// (db/team-members.ts). Nothing changes for a ticket of another company or one
// that is not solved. actorUserId must be the session's own user.
export async function reopenTicket(companyId: string, ticketId: string, actorUserId: string): Promise<ReopenResult> {
  return db.transaction(async (tx) => {
    // First, before the ticket is touched: it may be routed below, and routing
    // must not run at the same time as another routing in this company.
    await lockCompanyRow(tx, companyId);
    const [reopened] = await tx
      .update(tickets)
      .set({ status: "open", solvedAt: null, solvedByUserId: null, solvedWithoutEmail: false })
      .where(and(eq(tickets.id, ticketId), eq(tickets.companyId, companyId), eq(tickets.status, "solved")))
      .returning({ id: tickets.id, assignedToUserId: tickets.assignedToUserId });
    if (!reopened) {
      return { reopened: false, routedTo: null };
    }
    await recordTicketChange(tx, companyId, { ticketId, kind: "reopened", actorUserId });
    const tookOffAssignee = await unassignIfAssigneeLeft(tx, companyId, ticketId);
    if (!tookOffAssignee) {
      return { reopened: true, routedTo: null };
    }
    // Nobody chose this: the app took the ticket off someone who left.
    await recordTicketChange(tx, companyId, { ticketId, kind: "unassigned", actorUserId: null, targetUserId: reopened.assignedToUserId });
    const routedTo = await routeTicketIfUnassigned(tx, companyId, ticketId);
    return { reopened: true, routedTo };
  });
}

// Unassigns the ticket if its assignee can't take tickets any more. Their row
// is locked for this statement, so a removal being saved at this moment is
// waited for and then seen. Returns true when it unassigned someone.
async function unassignIfAssigneeLeft(tx: DbTransaction, companyId: string, ticketId: string): Promise<boolean> {
  const unassigned = await tx
    .update(tickets)
    .set({ assignedToUserId: null, assignedAutomatically: null })
    .where(
      and(
        eq(tickets.id, ticketId),
        eq(tickets.companyId, companyId),
        isNotNull(tickets.assignedToUserId),
        notExists(
          tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.id, tickets.assignedToUserId), eq(users.companyId, companyId), canTakeTickets))
            .for("share"),
        ),
      ),
    )
    .returning({ id: tickets.id });
  return unassigned.length > 0;
}
