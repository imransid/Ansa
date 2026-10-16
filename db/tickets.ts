import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import type { NewTicketInput } from "@/lib/validation/tickets";
import { db } from "./client";
import { companies, tickets } from "./schema";

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
>;

// No pagination yet. 50 is plenty until real calls create tickets (step 7).
const TICKET_LIST_LIMIT = 50;

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
    })
    .from(tickets)
    .where(eq(tickets.companyId, companyId))
    .orderBy(desc(tickets.ticketNumber))
    .limit(TICKET_LIST_LIMIT);
}

// Saves a new open ticket for one company and gives it that company's next ticket number.
export async function createTicket(
  companyId: string,
  input: NewTicketInput,
): Promise<Ticket> {
  return db.transaction(async (tx) => {
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
      })
      .returning();

    return ticket;
  });
}
