import "server-only";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { PAGE_SIZE, pageOffset } from "@/lib/pagination";
import { db } from "./client";
import { isStuckInboundEmail } from "./inbound-email-processing";
import { inboundEmails, tickets, type InboundEmailStatus } from "./schema";

// One received email as the Emails page lists it (step 27). No subject or
// body: those are only shown on the ticket an email became.
export type InboundEmailListItem = {
  id: string;
  receivedAt: Date;
  // Null until the content was fetched.
  fromAddress: string | null;
  status: InboundEmailStatus;
  ignoredReason: string | null;
  ticketNumber: number | null;
  // Its processing never finished (see isStuckInboundEmail).
  stuck: boolean;
};

// Lists one page of one company's received emails, newest first, with the
// ticket each one became, if any.
export async function getInboundEmailsForCompany(companyId: string, page: number): Promise<InboundEmailListItem[]> {
  return db
    .select({
      id: inboundEmails.id,
      receivedAt: inboundEmails.receivedAt,
      fromAddress: inboundEmails.fromAddress,
      status: inboundEmails.status,
      ignoredReason: inboundEmails.ignoredReason,
      ticketNumber: tickets.ticketNumber,
      stuck: sql<boolean>`coalesce(${isStuckInboundEmail()}, false)`,
    })
    .from(inboundEmails)
    .leftJoin(tickets, and(eq(tickets.companyId, companyId), eq(tickets.id, inboundEmails.ticketId)))
    .where(eq(inboundEmails.companyId, companyId))
    // id breaks ties, so an email never shows up on two pages.
    .orderBy(desc(inboundEmails.receivedAt), desc(inboundEmails.id))
    .limit(PAGE_SIZE)
    .offset(pageOffset(page));
}

// Counts one company's received emails, for "Page 2 of 5".
export async function countInboundEmailsForCompany(companyId: string): Promise<number> {
  const [row] = await db.select({ total: count() }).from(inboundEmails).where(eq(inboundEmails.companyId, companyId));
  return row?.total ?? 0;
}
