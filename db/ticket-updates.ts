import "server-only";
import { and, eq, exists, sql } from "drizzle-orm";
import { db } from "./client";
import { tickets, users } from "./schema";

// Each function below is a single UPDATE whose WHERE clause holds every rule.
// If any rule fails (wrong company, wrong status, unknown person), no row
// matches, nothing changes, and the function returns false.

// Assigns one company's ticket to a person in that same company, or unassigns
// it when assigneeUserId is null.
export async function assignTicket(
  companyId: string,
  ticketId: string,
  assigneeUserId: string | null,
): Promise<boolean> {
  // The assignee id comes from a form, so it is never trusted on its own:
  // the update only happens if that user exists in this same company.
  // (The tickets_assignee_in_same_company_fk foreign key is the second guard.)
  const assigneeIsInCompany =
    assigneeUserId === null
      ? sql`true`
      : exists(
          db
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.id, assigneeUserId), eq(users.companyId, companyId))),
        );

  const updated = await db
    .update(tickets)
    .set({ assignedToUserId: assigneeUserId })
    .where(
      and(
        eq(tickets.id, ticketId),
        eq(tickets.companyId, companyId),
        assigneeIsInCompany,
      ),
    )
    .returning({ id: tickets.id });
  return updated.length > 0;
}

// Marks one company's open ticket as solved by the given person.
// solvedByUserId must be the session's own user.
export async function markTicketSolved(
  companyId: string,
  ticketId: string,
  solvedByUserId: string,
): Promise<boolean> {
  const updated = await db
    .update(tickets)
    .set({
      status: "solved",
      solvedAt: sql`now()`,
      solvedByUserId,
    })
    .where(
      and(
        eq(tickets.id, ticketId),
        eq(tickets.companyId, companyId),
        eq(tickets.status, "open"),
      ),
    )
    .returning({ id: tickets.id });
  return updated.length > 0;
}

// Reopens one company's solved ticket and clears who solved it and when.
export async function reopenTicket(
  companyId: string,
  ticketId: string,
): Promise<boolean> {
  const updated = await db
    .update(tickets)
    .set({ status: "open", solvedAt: null, solvedByUserId: null })
    .where(
      and(
        eq(tickets.id, ticketId),
        eq(tickets.companyId, companyId),
        eq(tickets.status, "solved"),
      ),
    )
    .returning({ id: tickets.id });
  return updated.length > 0;
}
