import "server-only";
import { callCore } from "@/lib/core-api";
import { asFormResult } from "@/lib/core-views/ticket-actions";
import type { FormResult } from "@/lib/form-result";
import type { InboundEmailListItem } from "@/services/inbound-emails";

// The Emails page through the new backend (core's /api/v1/emails), in the
// shapes the page and its actions already read.

type CoreLine = Omit<InboundEmailListItem, "receivedAt" | "fromAddress"> & { receivedAt: string; from: string | null };

// One page of the company's received emails, newest first: who, when, what
// became of it, never the content.
export async function listReceivedEmailsFromCore(page: number): Promise<InboundEmailListItem[]> {
  const answer = await callCore<{ lines: CoreLine[] }>("GET", `/api/v1/emails?${new URLSearchParams({ page: String(page) })}`);
  if (!answer.ok) {
    throw new Error(`Core answered ${answer.status}`);
  }
  return answer.data.lines.map((line) => ({
    id: line.id,
    receivedAt: new Date(line.receivedAt),
    fromAddress: line.from,
    status: line.status,
    ignoredReason: line.ignoredReason,
    ticketNumber: line.ticketNumber,
    stuck: line.stuck,
  }));
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
