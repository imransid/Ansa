import "server-only";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { PAGE_SIZE, pageOffset } from "@/lib/pagination";
import type { TicketListQuery, TicketView } from "@/lib/validation/list-queries";
import { db } from "./client";
import { ticketSearchCondition, ticketViewCondition } from "./ticket-filters";
import { tickets, users } from "./schema";

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
> & {
  assigneeName: string | null;
  // Shown when the pointer rests on the name: two teammates can share a name.
  assigneeEmail: string | null;
};

export type TicketDetail = Ticket & {
  assigneeName: string | null;
  solvedByName: string | null;
  customerEmailSetByName: string | null;
};

// How many tickets each view of the list holds (step 29).
export type TicketViewCounts = Record<TicketView, number>;

// Which tickets to list: a view and a search from the URL, plus who is
// looking. viewerUserId must be the session's own user ("mine").
export type TicketListFilter = TicketListQuery & { viewerUserId: string };

// Separate views of the users table: the person assigned, the person who
// solved, and the person who typed in the customer's email. Every join also
// matches company_id, so a name from another company can never show up (the
// database foreign keys already prevent that link).
const assignee = alias(users, "assignee");
const solver = alias(users, "solver");
const emailSetter = alias(users, "email_setter");

// Lists one page of one company's tickets in one view, with an optional
// search, newest first (highest ticket number first).
export async function getTicketsForCompany(
  companyId: string,
  filter: TicketListFilter,
  page: number,
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
      assigneeEmail: assignee.email,
    })
    .from(tickets)
    .leftJoin(
      assignee,
      and(
        eq(assignee.id, tickets.assignedToUserId),
        eq(assignee.companyId, tickets.companyId),
      ),
    )
    .where(ticketListWhere(companyId, filter))
    .orderBy(desc(tickets.ticketNumber))
    .limit(PAGE_SIZE)
    .offset(pageOffset(page));
}

// Counts one company's tickets in every view at once, with the list's
// search: the numbers on the view links ("Unassigned (3)") and "Page 2 of 5".
// Each count uses its view's own condition (db/ticket-filters.ts), so a
// link's number always matches the list it opens.
export async function countTicketsPerView(
  companyId: string,
  viewerUserId: string,
  search: string | null,
): Promise<TicketViewCounts> {
  const [counts] = await db
    .select({
      open: countWhere(ticketViewCondition("open", viewerUserId)),
      mine: countWhere(ticketViewCondition("mine", viewerUserId)),
      unassigned: countWhere(ticketViewCondition("unassigned", viewerUserId)),
      solved: countWhere(ticketViewCondition("solved", viewerUserId)),
      all: countWhere(ticketViewCondition("all", viewerUserId)),
    })
    .from(tickets)
    // Every ticket of the company that the search finds; each count above
    // then keeps its own view's.
    .where(ticketListWhere(companyId, { view: "all", search, viewerUserId }));
  return counts ?? { open: 0, mine: 0, unassigned: 0, solved: 0, all: 0 };
}

// Says whether one company has any ticket at all. Reads one row, where the
// per-view counts above read every ticket of the company.
export async function companyHasTickets(companyId: string): Promise<boolean> {
  const [ticket] = await db.select({ id: tickets.id }).from(tickets).where(eq(tickets.companyId, companyId)).limit(1);
  return ticket !== undefined;
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

// The WHERE of the ticket list: ALWAYS the company first, then the view and
// the search.
function ticketListWhere(companyId: string, filter: TicketListFilter) {
  return and(
    eq(tickets.companyId, companyId),
    ticketViewCondition(filter.view, filter.viewerUserId),
    ticketSearchCondition(companyId, filter.search),
  );
}

// Counts only the rows that match, in the same pass over the table as the
// other counts. No condition ("all") counts every row.
function countWhere(condition: SQL | undefined) {
  return sql<number>`count(*) filter (where ${condition ?? sql`true`})`.mapWith(Number);
}
