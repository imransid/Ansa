import "server-only";
import { and, eq, exists, gt, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "./client";
import { companies, outgoingEmails, tickets } from "./schema";

// Delivering one customer email (services/customer-emails.ts): read it, claim
// it (pending or failed -> sending, in ONE update), send it, then record the
// outcome: failed only from "sending", sent never from "pending". So two
// deliveries of one email (the solve's own and a Retry, or two Retries) never
// both go ahead, and a late failure can never turn a sent email back into a
// failed one.

// Saved as last_error when the company's daily limit held an email back.
// Sending it clears it, and a failed attempt replaces it with its own error.
export const HELD_BACK_BY_DAILY_LIMIT = "daily_limit";

// A delivery still "sending" this long after it started was interrupted (the
// server stopped mid-send), so another one may start.
const STALE_SENDING_MINUTES = 10;

// Resend keeps an idempotency key for 24 hours after its first use. A try
// after that could reach the customer a second time, so from 23 hours on a
// delivery only starts when the person retrying confirmed it.
const REPEAT_SAFE_HOURS = 23;

// Only what the fixed "solved" email needs: no customer name or ticket subject,
// which the email never shows (lib/emails/ticket-solved.ts).
export type EmailToDeliver = {
  id: string;
  toEmail: string;
  ticketNumber: number;
  companyName: string;
  companyReplyToEmail: string | null;
  // Builds the company's forwarding address, the Reply-To when it has none of its own.
  companyInboundToken: string;
  // Its first try was 23 or more hours ago (see REPEAT_SAFE_HOURS).
  mayAlreadyHaveBeenDelivered: boolean;
};

// Reads what is needed to deliver one email of one company that a delivery
// may start on now. Undefined if it is sent, is being sent (started less than
// 10 minutes ago), is not this company's, or belongs to an earlier solve of a
// ticket that was reopened since (and maybe closed without emailing): a "your
// request is solved" email must only go out for the current solve, and only if
// that solve was meant to email.
export async function getEmailToDeliver(companyId: string, emailId: string): Promise<EmailToDeliver | undefined> {
  const [email] = await db
    .select({
      id: outgoingEmails.id,
      toEmail: outgoingEmails.toEmail,
      ticketNumber: tickets.ticketNumber,
      companyName: companies.name,
      companyReplyToEmail: companies.replyToEmail,
      companyInboundToken: companies.inboundToken,
      mayAlreadyHaveBeenDelivered: sql<boolean>`not ${firstTryIsRecentEnoughToRepeat()}`,
    })
    .from(outgoingEmails)
    .innerJoin(tickets, and(eq(tickets.id, outgoingEmails.ticketId), eq(tickets.companyId, outgoingEmails.companyId)))
    .innerJoin(companies, eq(companies.id, outgoingEmails.companyId))
    .where(and(eq(outgoingEmails.id, emailId), eq(outgoingEmails.companyId, companyId), canStartDelivery(), isForCurrentSolve()));
  return email;
}

// Claims one email of one company for delivery: ONE update checks every rule
// above and marks it "sending", so of two deliveries started at the same
// moment only one gets it. confirmedPossibleDuplicate: the person retrying
// agreed to send again although its first try was 23 or more hours ago.
// Returns true when this caller got it.
export async function claimEmailForDelivery(
  companyId: string,
  emailId: string,
  confirmedPossibleDuplicate: boolean,
): Promise<boolean> {
  const claimed = await db
    .update(outgoingEmails)
    .set({
      status: "sending",
      attemptCount: sql`${outgoingEmails.attemptCount} + 1`,
      firstAttemptAt: sql`coalesce(${outgoingEmails.firstAttemptAt}, now())`,
      lastAttemptAt: sql`now()`,
    })
    .where(
      and(
        eq(outgoingEmails.id, emailId),
        eq(outgoingEmails.companyId, companyId),
        canStartDelivery(),
        isForCurrentSolve(),
        confirmedPossibleDuplicate ? undefined : firstTryIsRecentEnoughToRepeat(),
      ),
    )
    .returning({ id: outgoingEmails.id });
  return claimed.length > 0;
}

// Records that the claimed delivery of one email of one company went out.
// Also over "failed": when a delivery outlived its claim (a retry started
// after 10 minutes and failed first), the email still reached the customer.
export async function markEmailSent(companyId: string, emailId: string, providerMessageId: string): Promise<void> {
  await db
    .update(outgoingEmails)
    .set({ status: "sent", sentAt: sql`now()`, providerMessageId, lastError: null })
    .where(and(eq(outgoingEmails.id, emailId), eq(outgoingEmails.companyId, companyId), inArray(outgoingEmails.status, ["sending", "failed"])));
}

// Records that the claimed delivery of one email of one company failed, with
// the sender's error code. Only from "sending": a late failure (such as
// Resend refusing a second request with the same key) can't undo "sent".
export async function markEmailFailed(companyId: string, emailId: string, errorCode: string): Promise<void> {
  await db
    .update(outgoingEmails)
    .set({ status: "failed", lastError: errorCode.slice(0, 100) })
    .where(and(eq(outgoingEmails.id, emailId), eq(outgoingEmails.companyId, companyId), eq(outgoingEmails.status, "sending")));
}

// Records that the company's daily limit held back one email of one company
// that a delivery could have started on. Its status stays (not sent yet, or
// failed), so Retry can still send it, and the ticket page says why it waits.
export async function markEmailHeldBackByDailyLimit(companyId: string, emailId: string): Promise<void> {
  await db
    .update(outgoingEmails)
    .set({ lastError: HELD_BACK_BY_DAILY_LIMIT })
    .where(and(eq(outgoingEmails.id, emailId), eq(outgoingEmails.companyId, companyId), canStartDelivery()));
}

// A delivery is on its way: "sending" for less than 10 minutes, or queued
// less than 10 minutes ago and not held back (the solve's own delivery runs
// right after the row is written). The ticket page offers no Retry then.
export function isDeliveryInProgress() {
  return or(
    and(eq(outgoingEmails.status, "sending"), gte(outgoingEmails.lastAttemptAt, minutesAgo(STALE_SENDING_MINUTES))),
    and(
      eq(outgoingEmails.status, "pending"),
      gte(outgoingEmails.createdAt, minutesAgo(STALE_SENDING_MINUTES)),
      or(isNull(outgoingEmails.lastError), ne(outgoingEmails.lastError, HELD_BACK_BY_DAILY_LIMIT)),
    ),
  );
}

// Never tried yet, or first tried less than 23 hours ago.
export function firstTryIsRecentEnoughToRepeat() {
  return or(isNull(outgoingEmails.firstAttemptAt), gt(outgoingEmails.firstAttemptAt, hoursAgo(REPEAT_SAFE_HOURS)));
}

// Never tried, failed, or "sending" for so long that it was interrupted.
function canStartDelivery() {
  return or(
    inArray(outgoingEmails.status, ["pending", "failed"]),
    and(eq(outgoingEmails.status, "sending"), lt(outgoingEmails.lastAttemptAt, minutesAgo(STALE_SENDING_MINUTES))),
  );
}

// The email belongs to its ticket's current solve, which was meant to email.
// The email row and solved_at are written in one transaction, so they share
// the same now(). Older emails are from an earlier solve. Also used for the
// "not delivered" list (db/undelivered-emails.ts).
export function isForCurrentSolve() {
  return exists(
    db
      .select({ id: tickets.id })
      .from(tickets)
      .where(
        and(
          eq(tickets.id, outgoingEmails.ticketId),
          eq(tickets.companyId, outgoingEmails.companyId),
          eq(tickets.status, "solved"),
          eq(tickets.solvedWithoutEmail, false),
          gte(outgoingEmails.createdAt, tickets.solvedAt),
        ),
      ),
  );
}

function minutesAgo(minutes: number) {
  return sql`now() - make_interval(mins => ${minutes})`;
}

function hoursAgo(hours: number) {
  return sql`now() - make_interval(hours => ${hours})`;
}
