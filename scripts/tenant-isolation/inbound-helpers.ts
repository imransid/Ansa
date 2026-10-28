// Shared by the step 27 email checks: received email content in Resend's own
// shape, and receiving plus processing one email with a FAKE fetcher and
// model (nothing here calls Resend or Claude).

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { inboundEmails, tickets } from "@/db/schema";
import type { InboundEmailContent } from "@/lib/inbound-email";
import type { ModelAsker } from "@/lib/model-request";
import { processInboundEmail } from "@/services/inbound-email-processing";
import { answer } from "./brain-guard-checks";
import { fakeModel } from "./brain-test-calls";
import { captureConsole, runId, type TestUser } from "./helpers";
import { forwardingAddressOf, postReceivedEmail, storedInboundEmail } from "./resend-helpers";

// The address each check's sender writes from: one per label, so the
// per-sender flood limit (10 an hour) never mixes checks up.
export function senderFor(label: string): string {
  return `${label}-${runId}@customer.test`;
}

// A received email as Resend's receiving API returns it: `from` is the bare
// address, the display name is only in headers.from. A verified sender.
export function resendContent(label: string, overrides: Partial<InboundEmailContent> = {}): InboundEmailContent {
  return {
    from: senderFor(label),
    to: [],
    subject: `Parcel help ${label}`,
    text: "Where is my parcel?",
    headers: { from: `Kim Lee <${senderFor(label)}>` },
    authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
    ...overrides,
  };
}

// A model that answers "needs a human" with a plain summary and subject.
export function plainTriageModel(): ModelAsker {
  return fakeModel(answer({ customer_issue: "Needs help.", ticket_subject: "Help", category: "" })).ask;
}

// Records one received email for the owner's company the way the signed
// webhook does (not processed yet) and returns its inbound_emails id.
export async function receiveEmailRow(owner: TestUser, label: string): Promise<string> {
  const resendId = `${label}-${runId}`;
  await postReceivedEmail(resendId, { to: [await forwardingAddressOf(owner)] });
  return (await storedInboundEmail(resendId)).id;
}

// The inbound_emails row with this id.
export async function inboundRow(inboundEmailId: string) {
  const [row] = await db.select().from(inboundEmails).where(eq(inboundEmails.id, inboundEmailId));
  return row;
}

// Receives one email and processes it with this content and model. Returns
// the outcome, everything logged, the stored row and its ticket (or null).
export async function receiveAndProcess(owner: TestUser, label: string, content: InboundEmailContent, askModel: ModelAsker = plainTriageModel()) {
  const id = await receiveEmailRow(owner, label);
  const { result: outcome, logs } = await captureConsole(() => processInboundEmail(owner.companyId, id, { fetchEmail: async () => content, askModel }));
  const row = await inboundRow(id);
  const [ticket] = row.ticketId ? await db.select().from(tickets).where(eq(tickets.id, row.ticketId)) : [];
  return { id, outcome, logs, row, ticket: ticket ?? null };
}
