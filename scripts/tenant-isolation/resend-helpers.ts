// Shared by the email channel checks: posts signed Resend webhooks straight
// into the handler (no server needed) and reads back what was stored.

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { getInboundTokenForCompany } from "@/db/inbound-emails";
import { inboundEmails } from "@/db/schema";
import { env } from "@/lib/env";
import { buildForwardingAddress } from "@/lib/forwarding-address";
import { signLikeResend } from "@/lib/resend-webhook";
import { handleResendWebhook } from "@/services/inbound-email-webhook";
import { captureConsole, type TestUser } from "./helpers";

// Every field Resend can put an address in. Values are `unknown` on purpose:
// the checks also send lists Resend should never send.
export type RecipientFields = { to?: unknown; cc?: unknown; bcc?: unknown; received_for?: unknown };

// The headers Resend would send for this body, signed with our secret.
export function signedLikeResend(body: Buffer, at = new Date()): Record<string, string> {
  return signLikeResend(body, `msg_${randomUUID()}`, at, env.RESEND_WEBHOOK_SECRET ?? "");
}

// An "email.received" event body for one email id.
export function receivedEventBody(emailId: string, recipients: RecipientFields): Buffer {
  return Buffer.from(JSON.stringify({ type: "email.received", data: { email_id: emailId, from: "x@customer.test", subject: "x", ...recipients } }));
}

// Posts a body to the Resend webhook handler. Returns the status and every
// line logged meanwhile; work scheduled for after the response is only counted.
export async function postToResendWebhook(body: Buffer, headers: Record<string, string>, scheduledTasks: string[] = []) {
  const request = new Request("http://localhost/api/webhooks/resend", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: new Uint8Array(body),
  });
  return captureConsole(async () => (await handleResendWebhook(request, () => { scheduledTasks.push("process"); })).status);
}

// Posts a signed "email.received" event for one email id.
export function postReceivedEmail(emailId: string, recipients: RecipientFields, scheduledTasks: string[] = []) {
  const body = receivedEventBody(emailId, recipients);
  return postToResendWebhook(body, signedLikeResend(body), scheduledTasks);
}

// The inbound_emails row saved for a Resend email id, if any.
export async function storedInboundEmail(resendEmailId: string) {
  return (await db.select().from(inboundEmails).where(eq(inboundEmails.resendEmailId, resendEmailId)))[0];
}

// The forwarding address of a test user's company.
export async function forwardingAddressOf(user: TestUser): Promise<string> {
  const token = await getInboundTokenForCompany(user.companyId);
  if (!token) {
    throw new Error("The test company has no forwarding token");
  }
  return buildForwardingAddress(token);
}
