import "server-only";
import { and, eq, exists, isNull, sql } from "drizzle-orm";
import { db } from "./client";
import { categories, companies, tickets, userCategories, users } from "./schema";
import { canTakeTickets } from "./users";

export type AssignmentNotice = {
  assigneeEmail: string;
  assigneeName: string;
  ticketNumber: number;
  ticketSubject: string;
  category: string | null;
  assignedAutomatically: boolean;
  // The assignee handles the ticket's (active) category. Routing can give
  // someone a ticket outside their categories: the same customer's other open
  // ticket is theirs (step 29). Then the email must not say "because you
  // handle ...".
  assigneeHandlesCategory: boolean;
  companyName: string;
};

// Reads what the "a ticket is yours" email needs, but only while the ticket of
// this company is still open and assigned to exactly this person (in the same
// company), and only while they can take tickets: confirmed, and not removed
// from the team. Returns undefined otherwise, so nobody is told about a ticket
// that isn't theirs, or about closed work (a solved ticket given to someone
// for the record, step 30). An unconfirmed account may have joined with an
// address that isn't theirs, under any name it typed: emailing it would send
// that name and the ticket to a stranger. A removed person must hear nothing more.
export async function getAssignmentNotice(
  companyId: string,
  ticketId: string,
  assigneeUserId: string,
): Promise<AssignmentNotice | undefined> {
  const assigneeHandlesCategory = exists(
    db
      .select({ userId: userCategories.userId })
      .from(userCategories)
      .innerJoin(categories, and(eq(categories.id, userCategories.categoryId), eq(categories.companyId, userCategories.companyId)))
      .where(
        and(
          eq(userCategories.companyId, companyId),
          eq(userCategories.userId, assigneeUserId),
          eq(categories.name, tickets.category),
          isNull(categories.archivedAt),
        ),
      ),
  );
  const [notice] = await db
    .select({
      assigneeEmail: users.email,
      assigneeName: users.name,
      ticketNumber: tickets.ticketNumber,
      ticketSubject: tickets.subject,
      category: tickets.category,
      assignedAutomatically: tickets.assignedAutomatically,
      assigneeHandlesCategory: sql<boolean>`${assigneeHandlesCategory}`,
      companyName: companies.name,
    })
    .from(tickets)
    .innerJoin(
      users,
      and(
        eq(users.id, tickets.assignedToUserId),
        eq(users.companyId, tickets.companyId),
        canTakeTickets,
      ),
    )
    .innerJoin(companies, eq(companies.id, tickets.companyId))
    .where(
      and(
        eq(tickets.id, ticketId),
        eq(tickets.companyId, companyId),
        eq(tickets.status, "open"),
        eq(tickets.assignedToUserId, assigneeUserId),
      ),
    );
  if (!notice) {
    return undefined;
  }
  return { ...notice, assignedAutomatically: notice.assignedAutomatically === true };
}
