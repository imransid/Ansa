import "server-only";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db, type DbTransaction } from "./client";
import { inboundEmails } from "./schema";
import { insertTicketWithNextNumber, type TicketToCreate } from "./ticket-creation";

// Turning one received email into a ticket (services/inbound-email-processing.ts):
// claim it ("processing"), then either record why it was ignored or save its
// ticket. Every step checks the email is still "processing", so a run that
// lost its claim to another one changes nothing.

// A processing run that started this long ago was cut off (a crash, a deploy,
// a time limit), so the email may be claimed again. Far longer than a real
// run: fetching the content with its retries, plus up to 3 Claude attempts of
// 60 seconds each.
export const STALE_EMAIL_PROCESSING_MINUTES = 15;

export type InboundEmailContentToStore = {
  // The sender's address, or what From held when it isn't one (capped).
  fromAddress: string | null;
  // Resend reported a passing DKIM or DMARC check (see the schema).
  senderVerified: boolean;
  // A Reply-To that differs from From (a suggestion for the expert only).
  replyToAddress: string | null;
  subjectEncrypted: string;
  bodyEncrypted: string | null;
  bodyFromHtml: boolean;
  attachmentCount: number;
  attachmentNamesEncrypted: string | null;
  inlineImageCount: number;
};

// Claims one company's received email for processing and returns its Resend
// id: an email nobody processed yet, or one whose processing started 15+
// minutes ago and never finished. Undefined if it isn't this company's, is
// finished, or another run is on it. One UPDATE checks and claims, so two
// runs never both get it.
export async function claimInboundEmail(companyId: string, inboundEmailId: string): Promise<string | undefined> {
  return claimWhere(companyId, inboundEmailId, or(eq(inboundEmails.status, "received"), isProcessingStale()));
}

// Claims one company's IGNORED email for another run (the Emails page), but
// only if it was ignored for one of these reasons. Returns its Resend id, or
// undefined when it isn't this company's, or isn't ignored for one of them.
export async function claimIgnoredInboundEmail(companyId: string, inboundEmailId: string, reasons: string[]): Promise<string | undefined> {
  return claimWhere(companyId, inboundEmailId, and(eq(inboundEmails.status, "ignored"), inArray(inboundEmails.ignoredReason, reasons)));
}

async function claimWhere(companyId: string, inboundEmailId: string, condition: ReturnType<typeof and>): Promise<string | undefined> {
  const [row] = await db
    .update(inboundEmails)
    .set({ status: "processing", ignoredReason: null, processingStartedAt: sql`now()` })
    .where(and(eq(inboundEmails.id, inboundEmailId), eq(inboundEmails.companyId, companyId), condition))
    .returning({ resendEmailId: inboundEmails.resendEmailId });
  return row?.resendEmailId;
}

// An email whose run was cut off: still "received" 15 minutes after it
// arrived (the run never started), or "processing" 15 minutes after the run
// started. The Emails page shows these, and the scheduled job runs them again
// (db/stuck-work.ts). Uses the database's clock, like the claim.
export function isStuckInboundEmail() {
  return or(
    and(eq(inboundEmails.status, "received"), lt(inboundEmails.receivedAt, minutesAgo(STALE_EMAIL_PROCESSING_MINUTES))),
    isProcessingStale(),
  );
}

function isProcessingStale() {
  return and(eq(inboundEmails.status, "processing"), lt(inboundEmails.processingStartedAt, minutesAgo(STALE_EMAIL_PROCESSING_MINUTES)));
}

function minutesAgo(minutes: number) {
  return sql`now() - make_interval(mins => ${minutes})`;
}

// Records that one company's email being processed was not turned into a
// ticket, and why (a code from lib/inbound-email-reasons.ts), plus who sent it
// when that is known. Only while it is still "processing": a run that lost its
// claim never overwrites what another run decided.
export async function markInboundEmailIgnored(
  companyId: string,
  inboundEmailId: string,
  reason: string,
  fromAddress: string | null,
): Promise<void> {
  const changes = fromAddress === null
    ? { status: "ignored" as const, ignoredReason: reason }
    : { status: "ignored" as const, ignoredReason: reason, fromAddress };
  await db
    .update(inboundEmails)
    .set(changes)
    .where(and(eq(inboundEmails.id, inboundEmailId), eq(inboundEmails.companyId, companyId), eq(inboundEmails.status, "processing")));
}

// Creates the ticket for one company's email and stores the (encrypted)
// content, in ONE transaction, but only while the email is still being
// processed (claimInboundEmail). Returns the ticket's id and who routing
// picked, or undefined, creating nothing, when the email was handled already.
export async function saveInboundEmailTicket(
  companyId: string,
  inboundEmailId: string,
  content: InboundEmailContentToStore,
  ticket: TicketToCreate,
): Promise<{ ticketId: string; assignedToUserId: string | null } | undefined> {
  return db.transaction(async (tx) => {
    if (!(await lockEmailStillProcessing(tx, companyId, inboundEmailId))) {
      return undefined;
    }
    const created = await insertTicketWithNextNumber(tx, companyId, ticket, null);
    const saved = await tx
      .update(inboundEmails)
      // Every column named, never a spread of `content`: an object with extra
      // fields (a companyId, a status, another ticket) can't write them.
      .set({
        fromAddress: content.fromAddress,
        senderVerified: content.senderVerified,
        replyToAddress: content.replyToAddress,
        subjectEncrypted: content.subjectEncrypted,
        bodyEncrypted: content.bodyEncrypted,
        bodyFromHtml: content.bodyFromHtml,
        attachmentCount: content.attachmentCount,
        attachmentNamesEncrypted: content.attachmentNamesEncrypted,
        inlineImageCount: content.inlineImageCount,
        status: "ticketed",
        ticketId: created.id,
      })
      .where(and(eq(inboundEmails.id, inboundEmailId), eq(inboundEmails.companyId, companyId), eq(inboundEmails.status, "processing")))
      .returning({ id: inboundEmails.id });
    if (saved.length === 0) {
      // Can't happen while the row is locked (below). If it ever does, the
      // ticket must not outlive its email: undo the whole transaction.
      tx.rollback();
    }
    return { ticketId: created.id, assignedToUserId: created.assignedToUserId };
  });
}

// WHY before the ticket is created: checking only in the UPDATE after it would
// let a second run for the same email (a retry, a stale re-claim) create a
// second ticket first. Locked, so that run waits here and then finds the email
// no longer processing.
async function lockEmailStillProcessing(tx: DbTransaction, companyId: string, inboundEmailId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: inboundEmails.id })
    .from(inboundEmails)
    .where(and(eq(inboundEmails.id, inboundEmailId), eq(inboundEmails.companyId, companyId), eq(inboundEmails.status, "processing")))
    .for("update");
  return row !== undefined;
}
