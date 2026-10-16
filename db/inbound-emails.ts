import "server-only";
import { and, eq } from "drizzle-orm";
import type { NewTicketInput } from "@/lib/validation/tickets";
import { db } from "./client";
import { inboundAddresses, inboundEmails } from "./schema";
import { insertTicketWithNextNumber } from "./ticket-creation";

export type InboundEmailContentToStore = {
  fromAddress: string;
  subjectEncrypted: string;
  bodyEncrypted: string | null;
};

// Links an inbound address to one company. Stored lowercase.
export async function createInboundAddress(companyId: string, address: string): Promise<void> {
  await db.insert(inboundAddresses).values({ companyId, address: address.toLowerCase() });
}

// Unlinks one of a company's inbound addresses. Emails already received keep
// their tickets. Returns false if the company has no such address.
export async function deleteInboundAddress(companyId: string, address: string): Promise<boolean> {
  const deleted = await db
    .delete(inboundAddresses)
    .where(and(eq(inboundAddresses.companyId, companyId), eq(inboundAddresses.address, address.toLowerCase())))
    .returning({ address: inboundAddresses.address });
  return deleted.length > 0;
}

// Finds which company owns one of the addresses an email was sent to.
// Not company-scoped on purpose: a webhook has no session. Call this only
// after the webhook signature is verified.
export async function findCompanyForInboundAddress(address: string): Promise<string | undefined> {
  const [row] = await db
    .select({ companyId: inboundAddresses.companyId })
    .from(inboundAddresses)
    .where(eq(inboundAddresses.address, address.toLowerCase()));
  return row?.companyId;
}

// Every inbound address of one company (to spot mail sent by ourselves).
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

// Marks one company's received email as being processed and returns its
// Resend id. Undefined if it isn't this company's or was already taken.
export async function claimInboundEmail(companyId: string, inboundEmailId: string): Promise<string | undefined> {
  const [row] = await db
    .update(inboundEmails)
    .set({ status: "processing" })
    .where(and(eq(inboundEmails.id, inboundEmailId), eq(inboundEmails.companyId, companyId), eq(inboundEmails.status, "received")))
    .returning({ resendEmailId: inboundEmails.resendEmailId });
  return row?.resendEmailId;
}

// Records that one company's email was deliberately not turned into a ticket.
export async function markInboundEmailIgnored(companyId: string, inboundEmailId: string, reason: string): Promise<void> {
  await db
    .update(inboundEmails)
    .set({ status: "ignored", ignoredReason: reason })
    .where(and(eq(inboundEmails.id, inboundEmailId), eq(inboundEmails.companyId, companyId)));
}

// Creates the ticket for one company's email and stores the (encrypted)
// content, in ONE transaction. Returns the ticket's id and who routing picked.
export async function saveInboundEmailTicket(
  companyId: string,
  inboundEmailId: string,
  content: InboundEmailContentToStore,
  ticket: NewTicketInput,
): Promise<{ ticketId: string; assignedToUserId: string | null }> {
  return db.transaction(async (tx) => {
    const created = await insertTicketWithNextNumber(tx, companyId, ticket, null);
    await tx
      .update(inboundEmails)
      .set({ status: "ticketed", ticketId: created.id, ...content })
      .where(and(eq(inboundEmails.id, inboundEmailId), eq(inboundEmails.companyId, companyId), eq(inboundEmails.status, "processing")));
    return { ticketId: created.id, assignedToUserId: created.assignedToUserId };
  });
}

// The original email behind one company's ticket, if it came from email.
export async function getInboundEmailForTicket(companyId: string, ticketId: string) {
  const [row] = await db
    .select({
      id: inboundEmails.id,
      fromAddress: inboundEmails.fromAddress,
      subjectEncrypted: inboundEmails.subjectEncrypted,
      bodyEncrypted: inboundEmails.bodyEncrypted,
      receivedAt: inboundEmails.receivedAt,
    })
    .from(inboundEmails)
    .where(and(eq(inboundEmails.companyId, companyId), eq(inboundEmails.ticketId, ticketId)));
  return row;
}
