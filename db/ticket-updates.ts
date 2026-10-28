import "server-only";
import { and, eq, exists, isNull, sql } from "drizzle-orm";
import { db, type DbTransaction } from "./client";
import { lockCompanyRow } from "./company-lock";
import { isForeignKeyViolation } from "./errors";
import { routeTicketIfUnassigned } from "./routing";
import { categories, tickets, users } from "./schema";
import { recordTicketChange } from "./ticket-activity";
import { canTakeTickets } from "./users";

// Each function below changes one ticket with an UPDATE whose WHERE clause
// holds every rule, and records the change in the ticket's history in the
// same transaction (db/ticket-activity.ts). If a rule fails (wrong company,
// unknown person or category), nothing changes: "refused". Saving the
// assignee or category the ticket already has changes nothing and records
// nothing: "unchanged" (a re-saved assignee must not flip a routed ticket to
// "assigned by a person", nor email them again). The one exception: re-saving
// the category of an open, unassigned ticket still routes it (see
// setTicketCategory). Solving is in db/ticket-solving.ts, reopening in
// db/ticket-reopening.ts.

export type TicketChangeOutcome = "changed" | "unchanged" | "refused";

// Assigns one company's ticket to a person in that same company who can take
// tickets (confirmed, not removed), or unassigns it when assigneeUserId is
// null. actorUserId must be the session's own user.
export async function assignTicket(
  companyId: string,
  ticketId: string,
  assigneeUserId: string | null,
  actorUserId: string,
): Promise<TicketChangeOutcome> {
  return db.transaction(async (tx) => {
    // First, before the ticket and the assignee are locked: a teammate's
    // removal takes this lock first too (db/company-lock.ts says why).
    await lockCompanyRow(tx, companyId);
    const current = await lockTicketForChange(tx, companyId, ticketId);
    if (!current) {
      return "refused";
    }
    if (current.assignedToUserId === assigneeUserId) {
      return "unchanged";
    }
    const updated = await tx
      .update(tickets)
      // A person chose this assignee, so it is not automatic (null = unassigned).
      .set({ assignedToUserId: assigneeUserId, assignedAutomatically: assigneeUserId === null ? null : false })
      .where(and(eq(tickets.id, ticketId), eq(tickets.companyId, companyId), assigneeCanTakeTickets(tx, companyId, assigneeUserId)))
      .returning({ id: tickets.id });
    if (updated.length === 0) {
      return "refused";
    }
    await recordTicketChange(tx, companyId, {
      ticketId,
      kind: assigneeUserId === null ? "unassigned" : "assigned",
      actorUserId,
      // Unassigning records who was taken off.
      targetUserId: assigneeUserId ?? current.assignedToUserId,
    });
    return "changed";
  });
}

// Sets (or changes) the customer's email on one company's ticket and records
// who did it and when, also when it is the address the ticket already has (it
// then records who entered it last). setByUserId must be the session's own
// user. Returns false for a ticket of another company. Emails already queued
// keep the address they were queued with (outgoing_emails.to_email).
export async function setTicketCustomerEmail(
  companyId: string,
  ticketId: string,
  customerEmail: string,
  setByUserId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(tickets)
      .set({
        customerEmail,
        customerEmailSetByUserId: setByUserId,
        customerEmailSetAt: sql`now()`,
      })
      .where(and(eq(tickets.id, ticketId), eq(tickets.companyId, companyId)))
      .returning({ id: tickets.id });
    if (updated.length === 0) {
      return false;
    }
    // The address itself stays out of the history: only who set it, and when.
    await recordTicketChange(tx, companyId, { ticketId, kind: "customer_email_set", actorUserId: setByUserId });
    return true;
  });
}

// Sets (or clears, with null) the category of one company's ticket. The
// category must be an active category of the same company. An open,
// unassigned ticket is then routed to an expert for it, also when the
// category is the one it already has; an assigned one keeps its assignee.
// routedTo says who routing picked, if anyone. actorUserId must be the
// session's own user.
export async function setTicketCategory(
  companyId: string,
  ticketId: string,
  category: string | null,
  actorUserId: string,
): Promise<{ outcome: TicketChangeOutcome; routedTo: string | null }> {
  try {
    return await saveTicketCategory(companyId, ticketId, category, actorUserId);
  } catch (error) {
    // The category was renamed between the UPDATE's check and its foreign
    // key check (a rename takes no lock this waits for): the name the
    // person picked no longer exists. Nothing was saved (the transaction
    // rolled back), as for any category that isn't there.
    if (isForeignKeyViolation(error)) {
      return { outcome: "refused", routedTo: null };
    }
    throw error;
  }
}

// setTicketCategory's transaction. May throw a foreign key violation (see there).
async function saveTicketCategory(
  companyId: string,
  ticketId: string,
  category: string | null,
  actorUserId: string,
): Promise<{ outcome: TicketChangeOutcome; routedTo: string | null }> {
  return db.transaction(async (tx) => {
    // First, before the ticket is touched: routing below must not run at the
    // same time as another routing in this company (db/routing.ts).
    await lockCompanyRow(tx, companyId);
    const current = await lockTicketForChange(tx, companyId, ticketId);
    if (!current) {
      return { outcome: "refused", routedTo: null };
    }
    if (current.category === category) {
      // Nothing to save, but routing still runs: saving the category again is
      // how a ticket someone took off its assignee goes back to routing.
      // Routing writes its own "routed" row and leaves assigned and solved
      // tickets alone.
      const routedTo = category ? await routeTicketIfUnassigned(tx, companyId, ticketId) : null;
      return { outcome: routedTo ? "changed" : "unchanged", routedTo };
    }
    const updated = await tx
      .update(tickets)
      .set({ category })
      .where(and(eq(tickets.id, ticketId), eq(tickets.companyId, companyId), categoryIsUsable(tx, companyId, category)))
      .returning({ id: tickets.id });
    if (updated.length === 0) {
      return { outcome: "refused", routedTo: null };
    }
    await recordTicketChange(tx, companyId, { ticketId, kind: "category_set", actorUserId, category });
    const routedTo = category ? await routeTicketIfUnassigned(tx, companyId, ticketId) : null;
    return { outcome: "changed", routedTo };
  });
}

// Reads what one company's ticket has now and locks its row until the
// transaction ends, so the "unchanged" comparison can't go stale before the
// UPDATE. Undefined for a ticket of another company. WHY "no key update":
// notes and queued emails pointing at the ticket can still be written meanwhile.
async function lockTicketForChange(tx: DbTransaction, companyId: string, ticketId: string) {
  const [ticket] = await tx
    .select({ assignedToUserId: tickets.assignedToUserId, category: tickets.category })
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.companyId, companyId)))
    .for("no key update");
  return ticket;
}

// The assignee id comes from a form, so it is never trusted on its own: the
// update only happens if that user is in this same company and can take
// tickets. Their row is locked for the statement, so assigning someone while
// their removal is being saved waits for it, then refuses. (The
// tickets_assignee_in_same_company_fk foreign key is the second guard.)
function assigneeCanTakeTickets(tx: DbTransaction, companyId: string, assigneeUserId: string | null) {
  if (assigneeUserId === null) {
    return sql`true`;
  }
  return exists(
    tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, assigneeUserId), eq(users.companyId, companyId), canTakeTickets))
      .for("share"),
  );
}

// Checked inside the UPDATE: only an active category of this company.
function categoryIsUsable(tx: DbTransaction, companyId: string, category: string | null) {
  if (category === null) {
    return sql`true`;
  }
  return exists(
    tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.companyId, companyId), eq(categories.name, category), isNull(categories.archivedAt))),
  );
}
