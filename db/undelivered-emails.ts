import "server-only";
import { and, count, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "./client";
import { HELD_BACK_BY_DAILY_LIMIT, isDeliveryInProgress, isForCurrentSolve } from "./outgoing-email-delivery";
import { outgoingEmails, tickets, type DeliveryProblem, type EmailStatus } from "./schema";

// Customer "solved" emails that never reached the customer (step 27), for the
// short list on the Emails page and the notice on the dashboard: otherwise
// they only show as one line on each ticket's page, which nobody opens again.

export type UndeliveredCustomerEmail = {
  emailId: string;
  ticketNumber: number;
  toEmail: string;
  status: EmailStatus;
  deliveryProblem: DeliveryProblem | null;
  heldBackByDailyLimit: boolean;
  // When the row last changed: queued, tried, or reported by Resend.
  changedAt: Date;
};

// Failed, still not sent (or cut off mid-send) once no delivery is under way
// any more, or reported by Resend as bounced, suppressed or failed. Only for
// each ticket's current solve, the same rule as delivering it: an email of an
// earlier solve, of a ticket reopened since, is someone's work in progress.
// ("complained" isn't listed: that email was delivered.)
function isUndelivered() {
  return and(
    or(
      eq(outgoingEmails.status, "failed"),
      and(inArray(outgoingEmails.status, ["pending", "sending"]), sql`not coalesce(${isDeliveryInProgress()}, false)`),
      and(eq(outgoingEmails.status, "sent"), inArray(outgoingEmails.deliveryProblem, ["bounced", "suppressed", "failed"])),
    ),
    isForCurrentSolve(),
  );
}

// One company's undelivered customer emails, most recently changed first.
export async function getUndeliveredEmailsForCompany(companyId: string, limit: number): Promise<UndeliveredCustomerEmail[]> {
  const rows = await db
    .select({
      emailId: outgoingEmails.id,
      ticketNumber: tickets.ticketNumber,
      toEmail: outgoingEmails.toEmail,
      status: outgoingEmails.status,
      deliveryProblem: outgoingEmails.deliveryProblem,
      lastError: outgoingEmails.lastError,
      changedAt: outgoingEmails.updatedAt,
    })
    .from(outgoingEmails)
    .innerJoin(tickets, and(eq(tickets.id, outgoingEmails.ticketId), eq(tickets.companyId, outgoingEmails.companyId)))
    .where(and(eq(outgoingEmails.companyId, companyId), isUndelivered()))
    .orderBy(desc(outgoingEmails.updatedAt), desc(outgoingEmails.id))
    .limit(limit);
  // The page only needs to know whether the limit held it back, not the error code.
  return rows.map(({ lastError, ...email }) => ({ ...email, heldBackByDailyLimit: lastError === HELD_BACK_BY_DAILY_LIMIT }));
}

// How many customer emails of one company were not delivered.
export async function countUndeliveredEmailsForCompany(companyId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(outgoingEmails)
    .where(and(eq(outgoingEmails.companyId, companyId), isUndelivered()));
  return row?.total ?? 0;
}
