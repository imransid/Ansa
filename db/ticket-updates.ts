import "server-only";
import { and, eq, exists, sql } from "drizzle-orm";
import { db } from "./client";
import { outgoingEmails, tickets, users } from "./schema";

// Each function below changes tickets with an UPDATE whose WHERE clause holds every rule.
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

export type SolveResult = {
  solved: boolean;
  // The queued "your request is solved" email, or null when the customer has
  // no email address on file (or the ticket was not solved).
  queuedEmailId: string | null;
};

// Marks one company's open ticket as solved by the given person and, if the
// customer has an email address, queues the "solved" email in the same
// transaction. solvedByUserId must be the session's own user.
export async function markTicketSolvedAndQueueEmail(
  companyId: string,
  ticketId: string,
  solvedByUserId: string,
): Promise<SolveResult> {
  // One transaction: either the ticket is solved AND its email is queued, or
  // neither happens. The email is delivered after this commits.
  return db.transaction(async (tx) => {
    const [solvedTicket] = await tx
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
      .returning({ id: tickets.id, customerEmail: tickets.customerEmail });

    if (!solvedTicket) {
      return { solved: false, queuedEmailId: null };
    }
    if (!solvedTicket.customerEmail) {
      return { solved: true, queuedEmailId: null };
    }

    const [queuedEmail] = await tx
      .insert(outgoingEmails)
      .values({
        companyId,
        ticketId: solvedTicket.id,
        kind: "ticket_solved",
        toEmail: solvedTicket.customerEmail,
      })
      .returning({ id: outgoingEmails.id });

    return { solved: true, queuedEmailId: queuedEmail.id };
  });
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

// Sets (or changes) the customer's email on one company's ticket and records
// who did it and when. setByUserId must be the session's own user.
// Emails already queued keep the address they were queued with (outgoing_emails.to_email).
export async function setTicketCustomerEmail(
  companyId: string,
  ticketId: string,
  customerEmail: string,
  setByUserId: string,
): Promise<boolean> {
  const updated = await db
    .update(tickets)
    .set({
      customerEmail,
      customerEmailSetByUserId: setByUserId,
      customerEmailSetAt: sql`now()`,
    })
    .where(and(eq(tickets.id, ticketId), eq(tickets.companyId, companyId)))
    .returning({ id: tickets.id });
  return updated.length > 0;
}
