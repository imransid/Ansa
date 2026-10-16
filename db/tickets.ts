import "server-only";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { NewTicketInput } from "@/lib/validation/tickets";
import { db, type DbTransaction } from "./client";
import { companies, tickets, users, type TicketStatus } from "./schema";

export type Ticket = typeof tickets.$inferSelect;

export type TicketListItem = Pick<
  Ticket,
  | "id"
  | "ticketNumber"
  | "subject"
  | "status"
  | "channel"
  | "customerName"
  | "customerEmail"
  | "customerPhone"
  | "createdAt"
> & { assigneeName: string | null };

export type TicketDetail = Ticket & {
  assigneeName: string | null;
  solvedByName: string | null;
};

export type TicketCounts = Record<TicketStatus, number>;

// No pagination yet. 50 is plenty until real calls create tickets (step 7).
const TICKET_LIST_LIMIT = 50;

// Two separate views of the users table: the person assigned and the person
// who solved. Both joins also match company_id, so a name from another company
// can never show up (the database foreign keys already prevent that link).
const assignee = alias(users, "assignee");
const solver = alias(users, "solver");

// Lists one company's tickets, newest first (highest ticket number first).
export async function getTicketsForCompany(
  companyId: string,
): Promise<TicketListItem[]> {
  return db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      status: tickets.status,
      channel: tickets.channel,
      customerName: tickets.customerName,
      customerEmail: tickets.customerEmail,
      customerPhone: tickets.customerPhone,
      createdAt: tickets.createdAt,
      assigneeName: assignee.name,
    })
    .from(tickets)
    .leftJoin(
      assignee,
      and(
        eq(assignee.id, tickets.assignedToUserId),
        eq(assignee.companyId, tickets.companyId),
      ),
    )
    .where(eq(tickets.companyId, companyId))
    .orderBy(desc(tickets.ticketNumber))
    .limit(TICKET_LIST_LIMIT);
}

// Reads one ticket of one company by its per-company number (#1, #2, ...).
export async function getTicketByNumber(
  companyId: string,
  ticketNumber: number,
): Promise<TicketDetail | undefined> {
  const [row] = await db
    .select({
      ticket: tickets,
      assigneeName: assignee.name,
      solvedByName: solver.name,
    })
    .from(tickets)
    .leftJoin(
      assignee,
      and(
        eq(assignee.id, tickets.assignedToUserId),
        eq(assignee.companyId, tickets.companyId),
      ),
    )
    .leftJoin(
      solver,
      and(
        eq(solver.id, tickets.solvedByUserId),
        eq(solver.companyId, tickets.companyId),
      ),
    )
    .where(
      and(
        eq(tickets.companyId, companyId),
        eq(tickets.ticketNumber, ticketNumber),
      ),
    );

  if (!row) {
    return undefined;
  }
  return {
    ...row.ticket,
    assigneeName: row.assigneeName,
    solvedByName: row.solvedByName,
  };
}

// Counts one company's tickets per status, for the dashboard heading.
export async function getTicketCountsForCompany(
  companyId: string,
): Promise<TicketCounts> {
  const rows = await db
    .select({ status: tickets.status, total: count() })
    .from(tickets)
    .where(eq(tickets.companyId, companyId))
    .groupBy(tickets.status);

  const counts: TicketCounts = { open: 0, solved: 0 };
  for (const row of rows) {
    counts[row.status] = row.total;
  }
  return counts;
}

// Saves a new open ticket for one company and gives it that company's next ticket number.
export async function createTicket(
  companyId: string,
  input: NewTicketInput,
): Promise<Ticket> {
  return db.transaction((tx) => insertTicketWithNextNumber(tx, companyId, input, null));
}

// Same as createTicket, but inside a transaction the caller already opened,
// so the ticket is saved together with the caller's other changes (or not at all).
// callId links the ticket to the phone call it came from.
export async function insertTicketWithNextNumber(
  tx: DbTransaction,
  companyId: string,
  input: NewTicketInput,
  callId: string | null,
): Promise<Ticket> {
  // Bumping the counter locks this company's row until the transaction ends.
  // A second ticket created at the same moment waits here, then gets the
  // next number, so two tickets can never share a number.
  const [counter] = await tx
    .update(companies)
    .set({ lastTicketNumber: sql`${companies.lastTicketNumber} + 1` })
    .where(eq(companies.id, companyId))
    .returning({ ticketNumber: companies.lastTicketNumber });

  if (!counter) {
    throw new Error("Cannot create a ticket for a company that does not exist");
  }

  const [ticket] = await tx
    .insert(tickets)
    .values({
      companyId,
      ticketNumber: counter.ticketNumber,
      subject: input.subject,
      description: input.description,
      channel: input.channel,
      category: input.category,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone,
      callId,
    })
    .returning();

  return ticket;
}

// Finds the number of the ticket created from one call of one company, if any.
export async function getTicketNumberForCall(
  companyId: string,
  callId: string,
): Promise<number | null> {
  const [ticket] = await db
    .select({ ticketNumber: tickets.ticketNumber })
    .from(tickets)
    .where(and(eq(tickets.companyId, companyId), eq(tickets.callId, callId)));
  return ticket?.ticketNumber ?? null;
}
