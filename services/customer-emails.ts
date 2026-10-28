import "server-only";
import {
  claimEmailForDelivery,
  getEmailToDeliver,
  markEmailFailed,
  markEmailHeldBackByDailyLimit,
  markEmailSent,
  type EmailToDeliver,
} from "@/db/outgoing-email-delivery";
import { getLatestEmailForTicket, type CustomerEmailSummary } from "@/db/outgoing-emails";
import { renderTicketSolvedEmail } from "@/lib/emails/ticket-solved";
import type { FormResult } from "@/lib/form-result";
import { buildForwardingAddress } from "@/lib/forwarding-address";
import { buildFromHeader, sendEmail, type EmailMessage, type EmailSendResult } from "@/lib/send-email";
import type { SessionContext } from "@/lib/session";
import { retryEmailSchema } from "@/lib/validation/tickets";
import { isOverRateLimit, RATE_LIMITS, takeBackRateLimitAttempt } from "./rate-limit";

// Re-exported so pages can use the type without importing from /db.
export type { CustomerEmailSummary };

export type DeliveryOutcome = "sent" | "failed" | "not-deliverable" | "over-daily-limit" | "needs-confirmation";

type EmailSender = (message: EmailMessage) => Promise<EmailSendResult>;

export type DeliveryOptions = {
  // The person clicking Retry confirmed sending again although the email may
  // already have reached the customer (its first try was 23 or more hours ago).
  confirmedPossibleDuplicate?: boolean;
  // Only the checks pass this, with a fake sender.
  send?: EmailSender;
};

// Delivers one queued email of one company and records the outcome. The
// email is claimed first (db/outgoing-email-delivery.ts), so two deliveries
// of it never both send. Retrying is safe within 24 hours of its first try,
// because the email id is Resend's idempotency key; later only when confirmed.
// Over the company's daily limit nothing is sent: the email keeps its status
// (not sent yet, or failed) and is noted as held back, so the ticket page says
// why next to Retry, which can send it later.
export async function deliverOutgoingEmail(
  companyId: string,
  emailId: string,
  { confirmedPossibleDuplicate = false, send = sendEmail }: DeliveryOptions = {},
): Promise<DeliveryOutcome> {
  const email = await getEmailToDeliver(companyId, emailId);
  if (!email) {
    return "not-deliverable";
  }
  if (email.mayAlreadyHaveBeenDelivered && !confirmedPossibleDuplicate) {
    return "needs-confirmation";
  }
  // Counted only here, for an email that is about to go out, so solving
  // without an email address or closing without emailing never counts.
  if (await isOverRateLimit("customer-emails", companyId, RATE_LIMITS.customerEmailsPerCompany)) {
    await markEmailHeldBackByDailyLimit(companyId, emailId);
    return "over-daily-limit";
  }
  if (!(await claimEmailForDelivery(companyId, emailId, confirmedPossibleDuplicate))) {
    // Another delivery got it first, or the ticket changed meanwhile. This one
    // sends nothing, so it doesn't count toward the daily limit either.
    await takeBackRateLimitAttempt("customer-emails", companyId);
    return "not-deliverable";
  }

  const result = await sendWithoutThrowing(send, buildSolvedEmail(email));
  if (!result.ok) {
    // An error code only: never the recipient, the content or a provider's message.
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

// Tries again to deliver a failed, held-back, never-started or interrupted
// email of the session's company. Anyone in the company may do this.
export async function retryCustomerEmailForSession(
  session: SessionContext,
  input: unknown,
): Promise<FormResult> {
  const parsed = retryEmailSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { message: "Unknown email." } };
  }
  if (await isOverRateLimit("ticket-changes", session.userId, RATE_LIMITS.ticketChangesPerUser)) {
    return { ok: false, errors: { message: "Too many changes. Try again in a few minutes." } };
  }

  const outcome = await deliverOutgoingEmail(session.companyId, parsed.data.emailId, {
    confirmedPossibleDuplicate: parsed.data.confirmPossibleDuplicate,
  });
  if (outcome === "sent") {
    return { ok: true };
  }
  return { ok: false, errors: { message: RETRY_REFUSED_MESSAGES[outcome] } };
}

const RETRY_REFUSED_MESSAGES: Record<Exclude<DeliveryOutcome, "sent">, string> = {
  "not-deliverable": "This email was already sent, is being sent right now, or can no longer be sent.",
  "over-daily-limit": "Daily email limit reached. Use Retry later.",
  failed: "Sending failed again. Try later.",
  "needs-confirmation":
    "This email may already have reached the customer: it was first tried more than 23 hours ago. Reload the page to confirm sending it again.",
};

// The fixed "solved" email (no customer name, no ticket subject).
function buildSolvedEmail(email: EmailToDeliver): EmailMessage {
  return {
    from: buildFromHeader(email.companyName),
    to: email.toEmail,
    // Without a Reply-To, replies would go to our shared sending address,
    // which belongs to no company. The forwarding address brings them back
    // to this company as email tickets.
    replyTo: email.companyReplyToEmail ?? buildForwardingAddress(email.companyInboundToken),
    ...renderTicketSolvedEmail({ companyName: email.companyName, ticketNumber: email.ticketNumber }),
    idempotencyKey: `ticket-solved-${email.id}`,
  };
}

// A sender that throws (network error, full disk) is treated like one that
// reports a failure, so the email is marked failed instead of stuck sending.
async function sendWithoutThrowing(send: EmailSender, message: EmailMessage): Promise<EmailSendResult> {
  try {
    return await send(message);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.constructor.name : "unknown_error" };
  }
}
