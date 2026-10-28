import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./client";
import { isStuckInboundEmail } from "./inbound-email-processing";
import { companies, inboundAddresses, inboundEmails, tickets, type InboundEmailStatus } from "./schema";

// Support addresses, forwarding tokens, recording an email that arrived, and
// reading one back. Processing it (claim, ignore, ticket) is in
// db/inbound-email-processing.ts; the Emails page list in db/inbound-email-list.ts.

// The last email that reached one company, and what became of it.
export type LastInboundEmail = {
  receivedAt: Date;
  status: InboundEmailStatus;
  ignoredReason: string | null;
  ticketNumber: number | null;
  // Its processing never finished: the same rule as the Emails page
  // (isStuckInboundEmail), where "Process again" is.
  stuck: boolean;
};

// Adds an address customers write to, to one company's list. Stored
// lowercase. It never decides where email goes (see the schema).
export async function createInboundAddress(companyId: string, address: string): Promise<void> {
  await db.insert(inboundAddresses).values({ companyId, address: address.toLowerCase() });
}

// Removes an address from one company's list of support addresses. Returns
// false if the company has no such address.
export async function deleteInboundAddress(companyId: string, address: string): Promise<boolean> {
  const deleted = await db
    .delete(inboundAddresses)
    .where(and(eq(inboundAddresses.companyId, companyId), eq(inboundAddresses.address, address.toLowerCase())))
    .returning({ address: inboundAddresses.address });
  return deleted.length > 0;
}

// Finds the companies whose forwarding addresses carry these tokens (each
// company once; tokens are unique). Not company-scoped on purpose: a webhook
// has no session, and the token is how it finds the company. Call this only
// after the webhook signature is verified.
export async function findCompaniesForInboundTokens(tokens: string[]): Promise<string[]> {
  if (tokens.length === 0) {
    return [];
  }
  const rows = await db.select({ id: companies.id }).from(companies).where(inArray(companies.inboundToken, tokens));
  return rows.map((row) => row.id);
}

// The token of one company's forwarding address (lib/forwarding-address.ts).
export async function getInboundTokenForCompany(companyId: string): Promise<string | undefined> {
  const [row] = await db.select({ inboundToken: companies.inboundToken }).from(companies).where(eq(companies.id, companyId));
  return row?.inboundToken;
}

// Gives one company a new forwarding address token and returns it (operator
// script, for an address that gets spam). The database makes it, like the
// first one, so nobody picks it. The old address stops routing at once.
export async function replaceInboundTokenForCompany(companyId: string): Promise<string | undefined> {
  const [row] = await db
    .update(companies)
    .set({ inboundToken: sql`default` })
    .where(eq(companies.id, companyId))
    .returning({ inboundToken: companies.inboundToken });
  return row?.inboundToken;
}

// Every support address one company listed (to spot mail it sent itself).
export async function getInboundAddressesForCompany(companyId: string): Promise<string[]> {
  const rows = await db.select({ address: inboundAddresses.address }).from(inboundAddresses).where(eq(inboundAddresses.companyId, companyId));
  return rows.map((row) => row.address);
}

// Records that an email arrived for one company, unless it already did.
// Returns the new row's id, or null for a repeated delivery.
export async function insertInboundEmailIfNew(companyId: string, resendEmailId: string): Promise<string | null> {
  const [row] = await db
    .insert(inboundEmails)
    .values({ companyId, resendEmailId })
    .onConflictDoNothing({ target: inboundEmails.resendEmailId })
    .returning({ id: inboundEmails.id });
  return row?.id ?? null;
}

// The most recent email that reached one company, with its ticket number if it
// became a ticket. Undefined until the first email arrives.
export async function getLastInboundEmail(companyId: string): Promise<LastInboundEmail | undefined> {
  const [row] = await db
    .select({
      receivedAt: inboundEmails.receivedAt,
      status: inboundEmails.status,
      ignoredReason: inboundEmails.ignoredReason,
      ticketNumber: tickets.ticketNumber,
      stuck: sql<boolean>`coalesce(${isStuckInboundEmail()}, false)`,
    })
    .from(inboundEmails)
    .leftJoin(tickets, and(eq(tickets.companyId, companyId), eq(tickets.id, inboundEmails.ticketId)))
    .where(eq(inboundEmails.companyId, companyId))
    .orderBy(desc(inboundEmails.receivedAt), desc(inboundEmails.id))
    .limit(1);
  return row;
}

// The original email behind one company's ticket, if it came from email.
export async function getInboundEmailForTicket(companyId: string, ticketId: string) {
  const [row] = await db
    .select({
      id: inboundEmails.id,
      fromAddress: inboundEmails.fromAddress,
      senderVerified: inboundEmails.senderVerified,
      replyToAddress: inboundEmails.replyToAddress,
      subjectEncrypted: inboundEmails.subjectEncrypted,
      bodyEncrypted: inboundEmails.bodyEncrypted,
      bodyFromHtml: inboundEmails.bodyFromHtml,
      attachmentCount: inboundEmails.attachmentCount,
      attachmentNamesEncrypted: inboundEmails.attachmentNamesEncrypted,
      inlineImageCount: inboundEmails.inlineImageCount,
      receivedAt: inboundEmails.receivedAt,
    })
    .from(inboundEmails)
    .where(and(eq(inboundEmails.companyId, companyId), eq(inboundEmails.ticketId, ticketId)));
  return row;
}
