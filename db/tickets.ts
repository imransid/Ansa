import "server-only";
import { and, count, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "./client";
import { tickets, users, type TicketStatus } from "./schema";

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
  | "category"
  | "createdAt"
> & { assigneeName: string | null };

export type TicketDetail = Ticket & {
  assigneeName: string | null;
  solvedByName: string | null;
  customerEmailSetByName: string | null;
};

export type TicketCounts = Record<TicketStatus, number>;

// No pagination yet. 50 is plenty until real calls create tickets (step 7).
const TICKET_LIST_LIMIT = 50;

// Separate views of the users table: the person assigned, the person who
// solved, and the person who typed in the customer's email. Every join also
// matches company_id, so a name from another company can never show up (the
// database foreign keys already prevent that link).
const assignee = alias(users, "assignee");
const solver = alias(users, "solver");
const emailSetter = alias(users, "email_setter");

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
      category: tickets.category,
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
      customerEmailSetByName: emailSetter.name,
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
    .leftJoin(
      emailSetter,
      and(
        eq(emailSetter.id, tickets.customerEmailSetByUserId),
        eq(emailSetter.companyId, tickets.companyId),
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
    customerEmailSetByName: row.customerEmailSetByName,
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
