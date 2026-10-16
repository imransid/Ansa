import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "./client";
import { companies, tickets, users } from "./schema";

export type AssignmentNotice = {
  assigneeEmail: string;
  assigneeName: string;
  ticketNumber: number;
  ticketSubject: string;
  category: string | null;
  assignedAutomatically: boolean;
  companyName: string;
};

// Reads what the "a ticket is yours" email needs, but only while the ticket of
// this company is still assigned to exactly this person (in the same company).
// Returns undefined otherwise, so nobody is told about a ticket that isn't theirs.
export async function getAssignmentNotice(
  companyId: string,
  ticketId: string,
  assigneeUserId: string,
): Promise<AssignmentNotice | undefined> {
  const [notice] = await db
    .select({
      assigneeEmail: users.email,
      assigneeName: users.name,
      ticketNumber: tickets.ticketNumber,
      ticketSubject: tickets.subject,
      category: tickets.category,
      assignedAutomatically: tickets.assignedAutomatically,
      companyName: companies.name,
    })
    .from(tickets)
    .innerJoin(users, and(eq(users.id, tickets.assignedToUserId), eq(users.companyId, tickets.companyId)))
    .innerJoin(companies, eq(companies.id, tickets.companyId))
    .where(
      and(
        eq(tickets.id, ticketId),
        eq(tickets.companyId, companyId),
        eq(tickets.assignedToUserId, assigneeUserId),
      ),
    );
  if (!notice) {
    return undefined;
  }
  return { ...notice, assignedAutomatically: notice.assignedAutomatically === true };
}
