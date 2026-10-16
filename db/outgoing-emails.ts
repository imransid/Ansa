import "server-only";
import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import { db } from "./client";
import { companies, outgoingEmails, tickets, type DeliveryProblem, type EmailStatus } from "./schema";

export type CustomerEmailSummary = {
  id: string;
  status: EmailStatus;
  toEmail: string;
  sentAt: Date | null;
  providerMessageId: string | null;
  deliveryProblem: DeliveryProblem | null;
};

export type EmailToDeliver = {
  id: string;
  toEmail: string;
  ticketNumber: number;
  ticketSubject: string;
  customerName: string | null;
  companyName: string;
  companyReplyToEmail: string | null;
};

// Reads the most recent email of one ticket of one company.
export async function getLatestEmailForTicket(
  companyId: string,
  ticketId: string,
): Promise<CustomerEmailSummary | undefined> {
  const [email] = await db
    .select({
      id: outgoingEmails.id,
      status: outgoingEmails.status,
      toEmail: outgoingEmails.toEmail,
      sentAt: outgoingEmails.sentAt,
      providerMessageId: outgoingEmails.providerMessageId,
      deliveryProblem: outgoingEmails.deliveryProblem,
    })
    .from(outgoingEmails)
    .where(
      and(
        eq(outgoingEmails.companyId, companyId),
        eq(outgoingEmails.ticketId, ticketId),
      ),
    )
    .orderBy(desc(outgoingEmails.createdAt))
    .limit(1);
  return email;
}

// Reads what is needed to deliver one not-yet-sent email of one company.
// Returns undefined if the email is already sent, is not this company's, or
// belongs to an earlier solve of a ticket that was reopened since: a
// "your request is solved" email must only go out for the current solve.
export async function getEmailToDeliver(
  companyId: string,
  emailId: string,
): Promise<EmailToDeliver | undefined> {
  const [email] = await db
    .select({
      id: outgoingEmails.id,
      toEmail: outgoingEmails.toEmail,
      ticketNumber: tickets.ticketNumber,
      ticketSubject: tickets.subject,
      customerName: tickets.customerName,
      companyName: companies.name,
      companyReplyToEmail: companies.replyToEmail,
    })
    .from(outgoingEmails)
    .innerJoin(
      tickets,
      and(
        eq(tickets.id, outgoingEmails.ticketId),
        eq(tickets.companyId, outgoingEmails.companyId),
      ),
    )
    .innerJoin(companies, eq(companies.id, outgoingEmails.companyId))
    .where(
      and(
        eq(outgoingEmails.id, emailId),
        eq(outgoingEmails.companyId, companyId),
        ne(outgoingEmails.status, "sent"),
        eq(tickets.status, "solved"),
        // The email row and solved_at are written in one transaction, so they
        // share the same now(). Older emails are from an earlier solve.
        gte(outgoingEmails.createdAt, tickets.solvedAt),
      ),
    );
  return email;
}

// Records that one email of one company was delivered.
export async function markEmailSent(
  companyId: string,
  emailId: string,
  providerMessageId: string,
): Promise<void> {
  await db
    .update(outgoingEmails)
    .set({
      status: "sent",
      sentAt: sql`now()`,
      providerMessageId,
      lastError: null,
      attemptCount: sql`${outgoingEmails.attemptCount} + 1`,
    })
    .where(and(eq(outgoingEmails.id, emailId), eq(outgoingEmails.companyId, companyId)));
}

// Records a failed delivery attempt of one email of one company.
export async function markEmailFailed(
  companyId: string,
  emailId: string,
  error: string,
): Promise<void> {
  await db
    .update(outgoingEmails)
    .set({
      status: "failed",
      lastError: error.slice(0, 500),
      attemptCount: sql`${outgoingEmails.attemptCount} + 1`,
    })
    .where(and(eq(outgoingEmails.id, emailId), eq(outgoingEmails.companyId, companyId)));
}
