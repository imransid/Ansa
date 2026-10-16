import "server-only";
import {
  getEmailToDeliver,
  getLatestEmailForTicket,
  markEmailFailed,
  markEmailSent,
  type CustomerEmailSummary,
} from "@/db/outgoing-emails";
import { renderTicketSolvedEmail } from "@/lib/emails/ticket-solved";
import type { FormResult } from "@/lib/form-result";
import { buildFromHeader, sendEmail, type EmailSendResult } from "@/lib/send-email";
import type { SessionContext } from "@/lib/session";
import { ticketEmailIdSchema } from "@/lib/validation/tickets";
import { isOverRateLimit, RATE_LIMITS } from "./rate-limit";

// Re-exported so pages can use the type without importing from /db.
export type { CustomerEmailSummary };

export type DeliveryOutcome = "sent" | "failed" | "not-deliverable";

// Delivers one queued email of one company and records the outcome.
// Safe to call again for a failed email: the email id is the idempotency key.
export async function deliverOutgoingEmail(
  companyId: string,
  emailId: string,
): Promise<DeliveryOutcome> {
  const email = await getEmailToDeliver(companyId, emailId);
  if (!email) {
    return "not-deliverable";
  }

  const content = renderTicketSolvedEmail({
    companyName: email.companyName,
    customerName: email.customerName,
    ticketNumber: email.ticketNumber,
    ticketSubject: email.ticketSubject,
  });

  const result = await sendWithoutThrowing({
    from: buildFromHeader(email.companyName),
    to: email.toEmail,
    replyTo: email.companyReplyToEmail,
    ...content,
    idempotencyKey: `ticket-solved-${email.id}`,
  });

  if (!result.ok) {
    // Log the reason only. Never the recipient or the content.
    console.error(`Email delivery failed: ${result.error}`);
    await markEmailFailed(companyId, emailId, result.error);
    return "failed";
  }
  await markEmailSent(companyId, emailId, result.providerMessageId);
  return "sent";
}

// Reads the latest customer email of one ticket in the session's company.
export async function getLatestCustomerEmailForSession(
  session: SessionContext,
  ticketId: string,
): Promise<CustomerEmailSummary | null> {
  const email = await getLatestEmailForTicket(session.companyId, ticketId);
  return email ?? null;
}

// Tries again to deliver a failed (or stuck) email of the session's company.
// Anyone in the company may do this.
export async function retryCustomerEmailForSession(
  session: SessionContext,
  input: unknown,
): Promise<FormResult> {
  const parsed = ticketEmailIdSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "Unknown email." } };
  }
  if (await isOverRateLimit("ticket-changes", session.userId, RATE_LIMITS.ticketChangesPerUser)) {
    return { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };
  }

  const outcome = await deliverOutgoingEmail(session.companyId, parsed.data.emailId);
  if (outcome === "not-deliverable") {
    return { ok: false, errors: { message: "This email was already sent or can no longer be sent." } };
  }
  if (outcome === "failed") {
    return { ok: false, errors: { message: "Sending failed again. Try later." } };
  }
  return { ok: true };
}

// A sender that throws (network error, full disk) is treated like one that
// reports a failure, so the email is marked failed instead of stuck pending.
async function sendWithoutThrowing(
  message: Parameters<typeof sendEmail>[0],
): Promise<EmailSendResult> {
  try {
    return await sendEmail(message);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.name : "Unknown error" };
  }
}
