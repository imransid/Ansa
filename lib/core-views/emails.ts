import "server-only";
import { callCore } from "@/lib/core-api";
import { asFormResult } from "@/lib/core-views/ticket-actions";
import type { FormResult } from "@/lib/form-result";
import type { InboundEmailListItem } from "@/services/inbound-emails";
import type { UndeliveredCustomerEmail } from "@/services/undelivered-emails";

// The Emails page through the new backend (core's /api/v1/emails), in the
// shapes the page and its actions already read.

// What the page shows: one page of received emails and how many there are,
// and the newest customer emails never delivered and how many there are.
export type EmailsPage = {
  emails: InboundEmailListItem[];
  totalEmails: number;
  undelivered: UndeliveredCustomerEmail[];
  totalUndelivered: number;
};

type CoreLine = Omit<InboundEmailListItem, "receivedAt" | "fromAddress"> & { receivedAt: string; from: string | null };

type CoreUndelivered = Omit<UndeliveredCustomerEmail, "changedAt"> & { changedAt: string };

// Received emails: who, when, what became of each, never the content.
export async function getEmailsPageFromCore(page: number): Promise<EmailsPage> {
  const answer = await callCore<{ lines: CoreLine[]; total: number; undelivered: CoreUndelivered[]; undeliveredTotal: number }>(
    "GET",
    `/api/v1/emails?${new URLSearchParams({ page: String(page) })}`,
  );
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  return {
    emails: answer.data.lines.map(toListItem),
    totalEmails: answer.data.total,
    undelivered: answer.data.undelivered.map(toUndelivered),
    totalUndelivered: answer.data.undeliveredTotal,
  };
}

// "Process again": content unavailable, a processing error, or stuck (the filters apply).
export async function processEmailAgainThroughCore(inboundEmailId: string): Promise<FormResult> {
  return asFormResult(await callCore("POST", emailPath(inboundEmailId, "process-again")));
}

// "Make a ticket anyway": what the filters skipped becomes a request.
export async function makeTicketFromEmailThroughCore(inboundEmailId: string): Promise<FormResult> {
  return asFormResult(await callCore("POST", emailPath(inboundEmailId, "ticket-anyway")));
}

// The id is only a claim from a form: core checks it belongs to the session's company.
function emailPath(inboundEmailId: string, action: string): string {
  return `/api/v1/emails/${encodeURIComponent(inboundEmailId)}/${action}`;
}

function toListItem(line: CoreLine): InboundEmailListItem {
  return {
    id: line.id,
    receivedAt: new Date(line.receivedAt),
    fromAddress: line.from,
    status: line.status,
    ignoredReason: line.ignoredReason,
    ticketNumber: line.ticketNumber,
    stuck: line.stuck,
  };
}

function toUndelivered(email: CoreUndelivered): UndeliveredCustomerEmail {
  return {
    emailId: email.emailId,
    ticketNumber: email.ticketNumber,
    toEmail: email.toEmail,
    status: email.status,
    deliveryProblem: email.deliveryProblem,
    heldBackByDailyLimit: email.heldBackByDailyLimit,
    changedAt: new Date(email.changedAt),
  };
}
