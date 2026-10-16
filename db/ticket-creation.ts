import "server-only";
import { eq, sql } from "drizzle-orm";
import type { NewTicketInput } from "@/lib/validation/tickets";
import { db, type DbTransaction } from "./client";
import { companies, tickets } from "./schema";
import type { Ticket } from "./tickets";

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
