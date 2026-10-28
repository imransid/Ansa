import "server-only";
import { and, desc, eq, ne, or, sql, type SQL } from "drizzle-orm";
import { customerPhoneDigits } from "@/lib/phone-number";
import { db, type DbTransaction } from "./client";
import { phoneDigitsOf } from "./phone-digits";
import { tickets, users } from "./schema";
import { canTakeTickets } from "./users";

// Tickets from the same customer (step 29): the same phone number (compared
// by its digits, at least 7 of them, never a hidden caller's placeholder: see
// customerPhoneDigits) or the same email address, always in the SAME company.
// Only the ticket's own customer phone and email count. A received email's
// From only becomes the ticket's customer email once it is verified or an
// expert confirms it (step 25), so a forged sender can't pass for another
// customer and pull in their tickets.

export type SameCustomerTicket = {
  ticketNumber: number;
  subject: string;
  assigneeName: string | null;
  createdAt: Date;
};

type CustomerContact = { customerPhone: string | null; customerEmail: string | null };

// Anything that can run a select: the pool, or a transaction.
type QueryRunner = Pick<typeof db, "select">;

// The ticket page lists at most this many.
const MOST_TICKETS_LISTED = 20;

// Lists one company's other OPEN tickets from the same customer as this
// ticket, newest first, for the ticket page.
export async function getOtherOpenTicketsFromSameCustomer(companyId: string, ticketId: string): Promise<SameCustomerTicket[]> {
  const sameCustomer = await sameCustomerAsTicket(db, companyId, ticketId);
  if (!sameCustomer) {
    return [];
  }
  return db
    .select({
      ticketNumber: tickets.ticketNumber,
      subject: tickets.subject,
      assigneeName: users.name,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .leftJoin(users, and(eq(users.id, tickets.assignedToUserId), eq(users.companyId, tickets.companyId)))
    .where(and(eq(tickets.companyId, companyId), ne(tickets.id, ticketId), eq(tickets.status, "open"), sameCustomer))
    .orderBy(desc(tickets.ticketNumber))
    .limit(MOST_TICKETS_LISTED);
}

// Who has this customer's newest other open ticket, if they can take tickets
// (confirmed, not removed): a new ticket goes to them (db/routing.ts), so one
// customer deals with one expert. Inside the caller's transaction. Null when
// there is nobody.
export async function findSameCustomerAssignee(tx: DbTransaction, companyId: string, ticketId: string): Promise<string | null> {
  const sameCustomer = await sameCustomerAsTicket(tx, companyId, ticketId);
  if (!sameCustomer) {
    return null;
  }
  const [newest] = await tx
    .select({ userId: users.id })
    .from(tickets)
    .innerJoin(users, and(eq(users.id, tickets.assignedToUserId), eq(users.companyId, tickets.companyId)))
    .where(and(eq(tickets.companyId, companyId), ne(tickets.id, ticketId), eq(tickets.status, "open"), canTakeTickets, sameCustomer))
    .orderBy(desc(tickets.ticketNumber))
    .limit(1);
  return newest?.userId ?? null;
}

// "A ticket from the same customer as this one", or null when this ticket
// holds nothing that tells customers apart (no email, and no phone number
// customerPhoneDigits accepts). Callers must stop on null: and() would drop a
// missing condition and match every ticket.
async function sameCustomerAsTicket(runner: QueryRunner, companyId: string, ticketId: string): Promise<SQL | null> {
  const [contact] = await runner
    .select({ customerPhone: tickets.customerPhone, customerEmail: tickets.customerEmail })
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.companyId, companyId)));
  return contact ? sameCustomerAs(contact) : null;
}

function sameCustomerAs(contact: CustomerContact): SQL | null {
  const conditions: SQL[] = [];
  const digits = customerPhoneDigits(contact.customerPhone);
  if (digits) {
    conditions.push(eq(phoneDigitsOf(tickets.customerPhone), digits));
  }
  if (contact.customerEmail) {
    // Customer emails are saved lowercase (lib/email-address.ts); lower() on
    // both sides also covers older rows.
    conditions.push(eq(sql`lower(${tickets.customerEmail})`, contact.customerEmail.toLowerCase()));
  }
  return or(...conditions) ?? null;
}
