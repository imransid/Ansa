import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "./client";
import { outgoingEmails, tickets } from "./schema";
import { recordTicketChange } from "./ticket-activity";

// The two ways to solve a ticket: with the "solved" email to the customer, or
// "Close without emailing". Reopening is in db/ticket-reopening.ts. Like
// db/ticket-updates.ts, each UPDATE's WHERE clause holds every rule: if one
// fails (wrong company, not open, a different customer email), nothing changes.
// Each solve is recorded in the ticket's history in the same transaction
// (db/ticket-activity.ts), so it survives a reopen.

export type SolveResult = {
  solved: boolean;
  // The queued "your request is solved" email, or null when the customer has
  // no email address on file (or the ticket was not solved).
  queuedEmailId: string | null;
};

// Marks one company's open ticket as solved by the given person and, if the
// customer has an email address, queues the "solved" email in the same
// transaction. solvedByUserId must be the session's own user.
// confirmedCustomerEmail is the address the person saw and confirmed (null =
// the page showed none): the ticket must still have exactly that one.
export async function markTicketSolvedAndQueueEmail(
  companyId: string,
  ticketId: string,
  solvedByUserId: string,
  confirmedCustomerEmail: string | null,
): Promise<SolveResult> {
  // Checked in the same statement as the solve: a teammate changing the
  // address a moment before makes the solve match no row, instead of emailing
  // an address this person never saw.
  const customerEmailIsTheConfirmedOne =
    confirmedCustomerEmail === null
      ? isNull(tickets.customerEmail)
      : eq(tickets.customerEmail, confirmedCustomerEmail);

  // One transaction: either the ticket is solved AND its email is queued, or
  // neither happens. The email is delivered after this commits.
  return db.transaction(async (tx) => {
    const [solvedTicket] = await tx
      .update(tickets)
      .set({
        status: "solved",
        solvedAt: sql`now()`,
        solvedByUserId,
        solvedWithoutEmail: false,
      })
      .where(
        and(
          eq(tickets.id, ticketId),
          eq(tickets.companyId, companyId),
          eq(tickets.status, "open"),
          customerEmailIsTheConfirmedOne,
        ),
      )
      .returning({ id: tickets.id, customerEmail: tickets.customerEmail });

    if (!solvedTicket) {
      return { solved: false, queuedEmailId: null };
    }
    await recordTicketChange(tx, companyId, { ticketId, kind: "solved", actorUserId: solvedByUserId });
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

// Marks one company's open ticket as solved by the given person WITHOUT
// emailing the customer: no outgoing_emails row is written, and the ticket
// records that this was on purpose (tickets.solved_without_email). For spam,
// "thanks" replies, duplicates and forged senders. solvedByUserId must be the
// session's own user. Returns false for a ticket of another company or one
// that is not open.
export async function markTicketSolvedWithoutEmail(
  companyId: string,
  ticketId: string,
  solvedByUserId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const closed = await tx
      .update(tickets)
      .set({
        status: "solved",
        solvedAt: sql`now()`,
        solvedByUserId,
        solvedWithoutEmail: true,
      })
      .where(
        and(
          eq(tickets.id, ticketId),
          eq(tickets.companyId, companyId),
          eq(tickets.status, "open"),
        ),
      )
      .returning({ id: tickets.id });
    if (closed.length === 0) {
      return false;
    }
    await recordTicketChange(tx, companyId, { ticketId, kind: "closed_without_email", actorUserId: solvedByUserId });
    return true;
  });
}
