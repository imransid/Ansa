import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { ManualTicketInput, NewTicketInput } from "@/lib/validation/tickets";
import { db, type DbTransaction } from "./client";
import { routeNewTicket } from "./routing";
import { categories, companies, tickets } from "./schema";
import { recordTicketChange } from "./ticket-activity";
import type { Ticket } from "./tickets";

// What creating a ticket needs. categoryId is set when the category was picked
// from a list read earlier (Claude's answer for a call or an email, step 27):
// the ticket then gets that category's CURRENT name, read under a lock in the
// same transaction, so an owner renaming it meanwhile is followed instead of
// failing the save (and no category if it was archived meanwhile). Without
// categoryId, `category` is the name as given.
export type TicketToCreate = NewTicketInput & { categoryId?: string | null };

// The person who made a ticket in the app (step 31): typed it in
// ("created"), or escalated a call the AI marked solved ("escalated"). It
// goes in the ticket's history before routing's row. Tickets the AI's call
// and email processing make have no creator.
export type TicketCreator = { userId: string; how: "created" | "escalated" };

// Saves a new open ticket for one company and gives it that company's next ticket number.
export async function createTicket(
  companyId: string,
  input: NewTicketInput,
): Promise<Ticket> {
  return db.transaction((tx) => insertTicketWithNextNumber(tx, companyId, input, null));
}

// Saves a ticket a person typed in (step 31) for one company, in ONE
// transaction: the next ticket number, the "created" row of its history and
// its routing. creatorUserId must be the session's own user. The category is
// read by id under a lock (a rename meanwhile is followed; archived meanwhile,
// or not this company's = no category).
export async function createManualTicket(companyId: string, input: ManualTicketInput, creatorUserId: string): Promise<Ticket> {
  const ticket: TicketToCreate = {
    subject: input.subject,
    description: input.description,
    channel: "manual",
    category: null,
    categoryId: input.categoryId,
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
  };
  return db.transaction((tx) => insertTicketWithNextNumber(tx, companyId, ticket, null, { userId: creatorUserId, how: "created" }));
}

// Same as createTicket, but inside a transaction the caller already opened,
// so the ticket is saved together with the caller's other changes (or not at all).
// callId links the ticket to the phone call it came from. createdBy names the
// person who made it in the app, if one did (see TicketCreator).
// It is routed in the same transaction: to whoever has the same customer's
// other open ticket (step 29), else to an expert for its category (step 10).
export async function insertTicketWithNextNumber(
  tx: DbTransaction,
  companyId: string,
  input: TicketToCreate,
  callId: string | null,
  createdBy: TicketCreator | null = null,
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

  const category = input.categoryId === undefined ? input.category : await lockCurrentCategoryName(tx, companyId, input.categoryId);
  // A customer email a person typed in is recorded as entered by them (step 9).
  const emailEnteredBy = createdBy && input.customerEmail ? createdBy.userId : null;
  const [ticket] = await tx
    .insert(tickets)
    .values({
      companyId,
      ticketNumber: counter.ticketNumber,
      subject: input.subject,
      description: input.description,
      channel: input.channel,
      category,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerEmailSetByUserId: emailEnteredBy,
      customerEmailSetAt: emailEnteredBy ? sql`now()` : null,
      customerPhone: input.customerPhone,
      callId,
    })
    .returning();

  // Before routing, so the history reads in order: created, then routed.
  if (createdBy) {
    await recordTicketChange(tx, companyId, { ticketId: ticket.id, kind: createdBy.how, actorUserId: createdBy.userId });
  }
  const expertId = await routeNewTicket(tx, companyId, ticket.id);
  if (!expertId) {
    return ticket;
  }
  return { ...ticket, assignedToUserId: expertId, assignedAutomatically: true, routedToUserId: expertId };
}

// The current name of one of the company's active categories, or null.
// WHY "key share": a rename being saved at this moment is waited for, then
// its new name is read; and the next rename waits until this ticket is saved,
// then renames it with the others (ON UPDATE CASCADE). Tickets point at the
// category by name, so an old name read before Claude's minute-long answer
// would otherwise fail the foreign key.
async function lockCurrentCategoryName(tx: DbTransaction, companyId: string, categoryId: string | null): Promise<string | null> {
  if (!categoryId) {
    return null;
  }
  const [category] = await tx
    .select({ name: categories.name })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.companyId, companyId), isNull(categories.archivedAt)))
    .for("key share");
  return category?.name ?? null;
}
